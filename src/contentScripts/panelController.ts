import type { EditorView } from '@codemirror/view';
import type { ContentScriptContext } from 'api/types';
import type { LinkDirection, LinkItem, PanelSettings } from '../types';
import type { AlternateOpenMode, MessageOf } from '../messages';
import logger from '../logger';
import { request } from './bridge';
import { scrollToPendingTarget, type PendingScroll } from './editor/pendingScroll';
import { getContentScriptSettings } from './editor/pluginSettings';
import { BacklinksPanel, type PanelCloseReason } from './ui/backlinksPanel';

type LinkLoadMessage = MessageOf<'getBacklinks' | 'getOutgoingLinks'>;

interface LinkLoadConfig {
    createMessage: (noteId: string) => LinkLoadMessage;
    errorMessage: string;
}

const LINK_LOAD_CONFIG = {
    in: {
        createMessage: (noteId: string) => ({ type: 'getBacklinks', noteId }),
        errorMessage: 'Failed to load backlinks',
    },
    out: {
        createMessage: (noteId: string) => ({ type: 'getOutgoingLinks', noteId }),
        errorMessage: 'Failed to load outgoing links',
    },
} satisfies Record<LinkDirection, LinkLoadConfig>;

interface PanelDependencies {
    resolveNoteId: () => string | null;
    /** Called after the panel opens or closes, so the badge that shares its corner can follow. */
    onVisibilityChange: () => void;
    /** Called with each direction's freshly loaded rows. */
    onLinksLoaded: (direction: LinkDirection, links: readonly LinkItem[]) => void;
}

/**
 * Owns the popup for one editor view: opening and closing it, loading its rows, navigating to the
 * selected row, and scrolling the target note once it loads.
 */
export class PanelController {
    private panel: BacklinksPanel | null = null;
    // Monotonic token so a slow link response can't populate a stale/closed panel.
    private seq = 0;
    // After navigating, scroll the target note to the spot the selected row stands for. On Desktop,
    // the same EditorView is reused across note switches, so this survives the navigation.
    private pendingScroll: PendingScroll | null = null;

    public constructor(
        private readonly view: EditorView,
        private readonly context: ContentScriptContext,
        private readonly dependencies: PanelDependencies
    ) {}

    public isOpen(): boolean {
        return this.panel?.isOpen() ?? false;
    }

    public toggle(isMobile = false): void {
        if (this.isOpen()) {
            this.close(true);
        } else {
            this.open(isMobile);
        }
    }

    public setSettings(settings: PanelSettings): void {
        this.panel?.setSettings(settings);
    }

    /**
     * Closes the panel (its links belong to the previous note) and, if the switch came from
     * selecting a row, scrolls the new note to that row's target.
     */
    public handleNoteChange(noteId: string): void {
        this.close();

        const target = this.pendingScroll;
        this.pendingScroll = null;
        if (target && noteId === target.targetNoteId) {
            scrollToPendingTarget(this.view, target, this.dependencies.resolveNoteId);
        }
    }

    private open(isMobile: boolean): void {
        const noteId = this.dependencies.resolveNoteId();
        const panel = this.ensurePanel(isMobile);
        panel.open();
        this.dependencies.onVisibilityChange();

        if (!noteId) {
            panel.setError('in', 'Could not determine the current note');
            panel.setError('out', 'Could not determine the current note');
            return;
        }

        const seq = ++this.seq;
        // Always fetch fresh so the panel can't show stale results (e.g. after editing links since
        // the note loaded).
        void this.loadLinks('in', noteId, seq);
        void this.loadLinks('out', noteId, seq);
    }

    private close(focusEditor = false): void {
        this.seq += 1; // Invalidate any in-flight request.
        this.panel?.destroy();
        this.panel = null;
        if (focusEditor) {
            this.view.focus();
        }
        this.dependencies.onVisibilityChange();
    }

    private ensurePanel(isMobile: boolean): BacklinksPanel {
        this.panel ??= new BacklinksPanel(
            this.view,
            {
                onSelect: (link) => {
                    void this.navigateTo(link);
                },
                onCtrlClickSelect: (link) => this.navigateTo(link, 'ctrlClick'),
                onCtrlEnterSelect: (link) => this.navigateTo(link, 'ctrlEnter'),
                onMiddleClickSelect: (link) => this.navigateTo(link, 'middleClick'),
                onClose: (reason: PanelCloseReason) => {
                    this.close(reason === 'escape');
                },
            },
            getContentScriptSettings(this.view.state).panel,
            isMobile
        );
        return this.panel;
    }

    private async loadLinks(direction: LinkDirection, noteId: string, seq: number): Promise<void> {
        const config = LINK_LOAD_CONFIG[direction];
        try {
            const response = await request(this.context, config.createMessage(noteId));
            // Ignore if the panel was closed/re-opened while we awaited.
            if (seq !== this.seq || !this.panel?.isOpen()) {
                return;
            }
            // A failed (or missing) response must not render as "no links". The host logs the cause
            // of a reported failure.
            if (!response?.ok) {
                this.panel.setError(direction, config.errorMessage);
                return;
            }
            this.panel.setLinks(direction, response.links);
            this.dependencies.onLinksLoaded(direction, response.links);
        } catch (error) {
            logger.error(config.errorMessage, error);
            if (seq === this.seq && this.panel?.isOpen()) {
                this.panel.setError(direction, config.errorMessage);
            }
        }
    }

    private async navigateTo(link: LinkItem, mode: 'current' | AlternateOpenMode = 'current'): Promise<void> {
        // Only outgoing rows carry an anchor; a backlink opens its source note as a whole.
        const anchor = link.direction === 'out' ? link.anchor : '';

        if (mode !== 'current') {
            try {
                await request(this.context, { type: 'openNote', noteId: link.noteId, anchor, mode });
            } catch (error) {
                logger.error('Failed to open link with alternate behavior', { mode, error });
            }
            return;
        }

        this.pendingScroll = this.pendingScrollFor(link);
        this.close();
        try {
            await request(this.context, { type: 'openNote', noteId: link.noteId, anchor });
        } catch (error) {
            logger.error('Failed to navigate to link', error);
            this.pendingScroll = null;
        }
    }

    /**
     * Where to scroll once the selected row's note loads. For a backlink that's the occurrence
     * linking back to the note we're currently viewing (`:/<currentNoteId>`); in title-only mode
     * backlinks are collapsed to one row per note (not a specific occurrence), so don't attempt it.
     * For an outgoing link it's the anchored heading — Joplin also handles the `#anchor` passed to
     * `openItem`, but doing it here keeps the cursor placement and highlight consistent with
     * backlink navigation. Outgoing links without an anchor just open the target note.
     */
    private pendingScrollFor(link: LinkItem): PendingScroll | null {
        if (link.direction === 'out') {
            return link.anchor ? { targetNoteId: link.noteId, kind: 'anchor', anchor: link.anchor } : null;
        }
        const currentNoteId = this.dependencies.resolveNoteId();
        if (!currentNoteId || getContentScriptSettings(this.view.state).panel.preview.in === 'title') {
            return null;
        }
        return {
            targetNoteId: link.noteId,
            kind: 'reference',
            referencedNoteId: currentNoteId.toLowerCase(),
            occurrenceIndex: link.occurrenceIndex,
        };
    }
}
