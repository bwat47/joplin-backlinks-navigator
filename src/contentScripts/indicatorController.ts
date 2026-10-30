import type { EditorView } from '@codemirror/view';
import type { ContentScriptContext } from 'api/types';
import { type LinkCounts, type LinkDirection, type LinkItem, EMPTY_LINK_COUNTS } from '../types';
import type { IndicatorState } from '../messages';
import logger from '../logger';
import { request } from './bridge';
import { getDisplayCounts, toBacklinkCounts } from './linkDisplay';
import { getContentScriptSettings } from './editor/pluginSettings';
import { BacklinkIndicator } from './ui/backlinkIndicator';

const INDICATOR_DEBOUNCE_MS = 350;

interface IndicatorDependencies {
    resolveNoteId: () => string | null;
    isPanelOpen: () => boolean;
}

/** Owns the badge, its cached counts, and editor-scoped refresh work. */
export class IndicatorController {
    private enabled = false;
    private counts: LinkCounts = EMPTY_LINK_COUNTS;
    private seq = 0;
    private timer: number | null = null;
    private disposed = false;
    private readonly badge: BacklinkIndicator;

    public constructor(
        private readonly view: EditorView,
        private readonly context: ContentScriptContext,
        private readonly dependencies: IndicatorDependencies
    ) {
        this.badge = new BacklinkIndicator(view, () => {
            void request(context, { type: 'openPanel' });
        });
    }

    /** Clears cached state without cancelling queued or in-flight refreshes. */
    public reset(): void {
        this.enabled = false;
        this.counts = EMPTY_LINK_COUNTS;
        this.sync();
    }

    /**
     * Updates cached counts from rows the panel loaded; does not change visibility. Ignored while
     * the indicator is disabled.
     */
    public recordLinks(direction: LinkDirection, links: readonly LinkItem[]): void {
        if (!this.enabled) {
            return;
        }
        this.counts =
            direction === 'in'
                ? { ...this.counts, ...toBacklinkCounts(links) }
                : { ...this.counts, outgoing: links.length };
    }

    /**
     * Shows the badge if it has a positive cached count, the setting is on, and the panel isn't
     * open (the panel occupies the same top-right corner). Checking the setting here keeps a
     * response requested before the setting was turned off from re-showing the badge.
     */
    public sync(): void {
        if (this.disposed) {
            return;
        }
        const settings = getContentScriptSettings(this.view.state);
        if (this.dependencies.isPanelOpen() || !this.enabled || !settings.showIndicator) {
            this.badge.hide();
            return;
        }
        const counts = getDisplayCounts(this.counts, settings.panel.preview);
        if (counts.backlinks + counts.outgoing > 0) {
            this.badge.show(counts);
        } else {
            this.badge.hide();
        }
    }

    /** Debounces a fetch of the current note's counts, replacing any queued refresh or retry. */
    public scheduleRefresh(): void {
        if (this.disposed) {
            return;
        }
        this.cancelRefresh();
        this.timer = window.setTimeout(() => {
            this.timer = null;
            void this.refresh();
        }, INDICATOR_DEBOUNCE_MS);
    }

    /** Removes the badge and drops queued and in-flight refreshes. Safe to call more than once. */
    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.seq += 1;
        this.cancelRefresh();
        this.badge.destroy();
    }

    /**
     * Reads the disposed flag through a call so TypeScript doesn't keep a narrowing from
     * before an await; dispose() can run while a refresh is waiting on the host.
     */
    private isDisposed(): boolean {
        return this.disposed;
    }

    private async refresh(attempt = 0): Promise<void> {
        if (this.disposed) {
            return;
        }
        const noteId = this.dependencies.resolveNoteId();
        if (!noteId) {
            // The facet may not be populated yet right after the editor loads. Share the debounce
            // timer so a new refresh or disposal cancels the retry.
            if (attempt < 5) {
                this.timer = window.setTimeout(() => {
                    this.timer = null;
                    void this.refresh(attempt + 1);
                }, 150);
            }
            return;
        }

        const seq = ++this.seq;
        let state: IndicatorState | undefined;
        try {
            state = await request(this.context, { type: 'getIndicatorState', noteId });
        } catch (error) {
            if (!this.isDisposed()) {
                logger.warn('Failed to fetch backlink indicator state', error);
            }
            return;
        }

        // Ignore if the editor was destroyed, the note changed, or another refresh
        // superseded this one.
        if (this.isDisposed() || seq !== this.seq || this.dependencies.resolveNoteId() !== noteId) {
            return;
        }

        if (state?.enabled && state.ok) {
            this.enabled = true;
            this.counts = state.counts;
        } else {
            // Disabled, or the host couldn't count links (it logs why). Hide the badge
            // rather than show zeros that would misreport the note.
            this.reset();
            return;
        }
        this.sync();
    }

    private cancelRefresh(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
