/**
 * Backlinks Navigator content script for CodeMirror 6.
 *
 * Runs in the editor context (CodeMirror access, no direct Joplin API). It:
 * - Reads the current note id from Joplin's note-id facet
 * - Opens/toggles the floating backlinks panel
 * - Requests backlinks from the plugin host and renders the result
 * - Forwards navigation requests (clicking a backlink) to the host
 * - Closes the panel when the user switches notes
 *
 * See:
 * - index.ts - Plugin host that resolves backlinks and performs navigation
 * - messages.ts - Message protocol
 * - ui/backlinksPanel.ts - Floating panel UI
 */

import { type EditorView, ViewPlugin } from '@codemirror/view';
import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import { EDITOR_COMMAND_TOGGLE_PANEL, EDITOR_COMMAND_UPDATE_SETTINGS } from '../constants';
import type { LinkDirection, LinkItem } from '../types';
import type { AlternateOpenMode, MessageOf } from '../messages';
import { request } from './bridge';
import { BacklinksPanel, type PanelCloseReason } from './ui/backlinksPanel';
import { IndicatorController } from './indicatorController';
import { createNoteIdWatcher, type NoteIdFacet } from './editor/noteIdWatcher';
import { referenceHighlightExtension } from './editor/referenceHighlight';
import { scrollToPendingTarget, type PendingScroll } from './editor/pendingScroll';
import {
    applyContentScriptSettings,
    createSettingsExtension,
    getContentScriptSettings,
    syncInitialContentScriptSettings,
} from './editor/pluginSettings';
import logger from '../logger';

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

export default function backlinksNavigator(context: ContentScriptContext): MarkdownEditorContentScriptModule {
    return {
        plugin: (editorControl: CodeMirrorControl) => {
            // Extensions and listeners are scoped to this EditorView instance. When Joplin
            // destroys the editor (note close, plugin disable), they are cleaned up automatically.
            const view = editorControl.editor as EditorView;
            let panel: BacklinksPanel | null = null;
            // Monotonic token so a slow backlink response can't populate a stale/closed panel.
            let requestSeq = 0;
            // After navigating, scroll the target note to the spot the selected row stands for. On
            // Desktop, the same EditorView is reused across note switches, so this closure state
            // survives the navigation.
            let pendingScroll: PendingScroll | null = null;
            const noteIdFacet = editorControl.joplinExtensions?.noteIdFacet as NoteIdFacet | undefined;
            const resolveNoteId = (): string | null => {
                if (!noteIdFacet) {
                    return null;
                }
                try {
                    const value: unknown = view.state.facet(noteIdFacet);
                    if (Array.isArray(value)) {
                        const candidate: unknown = value[0];
                        return typeof candidate === 'string' && candidate ? candidate : null;
                    }
                    return typeof value === 'string' && value ? value : null;
                } catch (error) {
                    logger.warn('Failed to resolve active note id from facet', error);
                    return null;
                }
            };

            const indicator = new IndicatorController(view, context, {
                resolveNoteId,
                isPanelOpen: () => panel?.isOpen() ?? false,
            });

            const closePanel = (focusEditor = false): void => {
                requestSeq += 1; // Invalidate any in-flight request.
                panel?.destroy();
                panel = null;
                if (focusEditor) {
                    view.focus();
                }
                indicator.sync();
            };

            const navigateTo = async (
                link: LinkItem,
                mode: 'current' | AlternateOpenMode = 'current'
            ): Promise<void> => {
                // Only outgoing rows carry an anchor; a backlink's anchor (if any) points into the
                // note we're already viewing.
                const anchor = link.direction === 'out' ? link.anchor : '';

                if (mode !== 'current') {
                    try {
                        await request(context, { type: 'openNote', noteId: link.noteId, anchor, mode });
                    } catch (error) {
                        logger.error('Failed to open link with alternate behavior', { mode, error });
                    }
                    return;
                }

                // Record where to scroll once the target note loads. For a backlink that's the
                // occurrence linking back to the note we're currently viewing (`:/<currentNoteId>`);
                // in title-only mode backlinks are collapsed to one row per note (not a specific
                // occurrence), so don't attempt it. For an outgoing link it's the anchored heading —
                // Joplin also handles the `#anchor` we pass to `openItem`, but doing it here keeps
                // the cursor placement and highlight consistent with backlink navigation. Outgoing
                // links without an anchor just open the target note.
                const currentNoteId = resolveNoteId();
                const scrollToOccurrence =
                    link.direction === 'in' && getContentScriptSettings(view.state).panel.preview.in !== 'title';
                if (anchor) {
                    pendingScroll = { targetNoteId: link.noteId, kind: 'anchor', anchor };
                } else if (scrollToOccurrence && currentNoteId) {
                    pendingScroll = {
                        targetNoteId: link.noteId,
                        kind: 'reference',
                        referencedNoteId: currentNoteId.toLowerCase(),
                        occurrenceIndex: link.occurrenceIndex,
                    };
                } else {
                    pendingScroll = null;
                }

                closePanel(false);
                try {
                    await request(context, { type: 'openNote', noteId: link.noteId, anchor });
                } catch (error) {
                    logger.error('Failed to navigate to link', error);
                    pendingScroll = null;
                }
            };

            const handleNoteChange = (noteId: string): void => {
                // New note: drop the stale caches (and their indicator) before closing the panel.
                indicator.reset();
                closePanel(false);

                if (pendingScroll) {
                    const target = pendingScroll;
                    pendingScroll = null;
                    if (noteId === target.targetNoteId) {
                        scrollToPendingTarget(view, target, resolveNoteId);
                    }
                }

                indicator.scheduleRefresh();
            };

            const ensurePanel = (isMobile: boolean): BacklinksPanel => {
                if (!panel) {
                    panel = new BacklinksPanel(
                        view,
                        {
                            onSelect: (link) => {
                                void navigateTo(link);
                            },
                            onCtrlClickSelect: (link) => {
                                return navigateTo(link, 'ctrlClick');
                            },
                            onCtrlEnterSelect: (link) => {
                                return navigateTo(link, 'ctrlEnter');
                            },
                            onMiddleClickSelect: (link) => {
                                return navigateTo(link, 'middleClick');
                            },
                            onClose: (reason: PanelCloseReason) => {
                                closePanel(reason === 'escape');
                            },
                        },
                        getContentScriptSettings(view.state).panel,
                        isMobile
                    );
                }
                return panel;
            };

            const loadLinks = async (direction: LinkDirection, noteId: string, seq: number): Promise<void> => {
                const config = LINK_LOAD_CONFIG[direction];
                try {
                    const response = await request(context, config.createMessage(noteId));
                    // Ignore if the panel was closed/re-opened while we awaited.
                    if (seq !== requestSeq || !panel?.isOpen()) {
                        return;
                    }
                    // A failed (or malformed) response must not render as "no links". The host
                    // logs the cause of a reported failure.
                    if (response?.ok !== true || !Array.isArray(response.links)) {
                        panel.setError(direction, config.errorMessage);
                        return;
                    }
                    const links = response.links;
                    panel.setLinks(direction, links);
                    // Keep the badge's count fresh, but only when the indicator is enabled.
                    indicator.recordLinks(direction, links);
                } catch (error) {
                    logger.error(config.errorMessage, error);
                    if (seq === requestSeq && panel?.isOpen()) {
                        panel.setError(direction, config.errorMessage);
                    }
                }
            };

            const openPanel = (isMobile: boolean): void => {
                const noteId = resolveNoteId();
                const activePanel = ensurePanel(isMobile);
                activePanel.open();
                indicator.sync(); // Hides the badge: the panel occupies its corner.

                if (!noteId) {
                    activePanel.setError('in', 'Could not determine the current note');
                    activePanel.setError('out', 'Could not determine the current note');
                    return;
                }

                requestSeq += 1;
                const seq = requestSeq;

                // Always fetch fresh so the panel can't show stale results (e.g. after editing links
                // since the note loaded). The load handlers also refresh the indicator's cached
                // counts, so clicking the badge brings it up to date too.
                void loadLinks('in', noteId, seq);
                void loadLinks('out', noteId, seq);
            };

            const applySettingsUpdate = (settings: unknown): void => {
                const nextSettings = applyContentScriptSettings(view, settings);
                panel?.setSettings(nextSettings.panel);
                if (!nextSettings.showIndicator) {
                    indicator.reset();
                    return;
                }
                indicator.sync();
                indicator.scheduleRefresh();
            };

            const togglePanel = (isMobile?: boolean): void => {
                if (panel?.isOpen()) {
                    closePanel(true);
                } else {
                    openPanel(isMobile ?? false);
                }
            };

            // Close the panel when the user switches notes (backlinks are note-specific), and
            // scroll to the reference if the switch was triggered by selecting a backlink.
            if (noteIdFacet) {
                editorControl.addExtension(createNoteIdWatcher(noteIdFacet, handleNoteChange));
            }
            editorControl.addExtension(createSettingsExtension());
            editorControl.addExtension(referenceHighlightExtension);
            // The indicator is mounted outside CodeMirror's extension system but observes the
            // scroll DOM, so tie its teardown and pending async work to the editor's lifetime. The
            // panel needs no equivalent: it is destroyed on every close.
            editorControl.addExtension(ViewPlugin.define(() => ({ destroy: () => indicator.dispose() })));

            editorControl.registerCommand(EDITOR_COMMAND_UPDATE_SETTINGS, applySettingsUpdate);
            editorControl.registerCommand(EDITOR_COMMAND_TOGGLE_PANEL, togglePanel);

            // Check the initial note after settings arrive (the watcher only fires on subsequent switches).
            void syncInitialContentScriptSettings(context, view).finally(() => indicator.scheduleRefresh());
        },
    };
}
