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

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import { EDITOR_COMMAND_TOGGLE_PANEL } from '../constants';
import type { LinkItem, PanelDimensions, PanelSettings } from '../types';
import { DEFAULT_LINK_PREVIEW_SETTINGS } from '../types';
import type {
    ContentScriptToPluginMessage,
    GetBacklinksResponse,
    GetOutgoingLinksResponse,
    IndicatorState,
} from '../messages';
import { normalizePanelDimensions } from '../panelDimensions';
import { BacklinksPanel, type PanelCloseReason } from './ui/backlinksPanel';
import { BacklinkIndicator } from './ui/backlinkIndicator';
import { createNoteIdWatcher } from './ui/noteIdWatcher';
import { findMarkdownLinkRange, type MarkdownLinkRange } from './markdownLinkPosition';
import { referenceHighlightExtension, setReferenceHighlightEffect } from './referenceHighlight';
import logger from '../logger';

const INDICATOR_DEBOUNCE_MS = 350;

export default function backlinksNavigator(context: ContentScriptContext): MarkdownEditorContentScriptModule {
    return {
        plugin: (editorControl: CodeMirrorControl) => {
            // Extensions and listeners are scoped to this EditorView instance. When Joplin
            // destroys the editor (note close, plugin disable), they are cleaned up automatically.
            const view = editorControl.editor as EditorView;
            let panel: BacklinksPanel | null = null;
            let panelSettings: PanelSettings = {
                dimensions: normalizePanelDimensions(),
                preview: { ...DEFAULT_LINK_PREVIEW_SETTINGS },
            };
            // Monotonic token so a slow backlink response can't populate a stale/closed panel.
            let requestSeq = 0;
            // After navigating to a backlink, scroll the target note to the line that references
            // the note we came from. On Desktop, the same EditorView is reused across note switches, so this
            // closure state survives the navigation.
            let pendingScroll: { targetNoteId: string; needle: string; occurrenceIndex: number } | null = null;
            // Link counts backing the indicator badge, populated only when the indicator is enabled.
            // `null` means "indicator off / not fetched"; that null-vs-array distinction also acts as
            // the "is the indicator enabled?" proxy when the panel refreshes these after a fresh load.
            // The panel itself always fetches fresh and does not read these.
            let currentNoteBacklinks: LinkItem[] | null = null;
            let currentNoteOutgoing: LinkItem[] | null = null;
            let indicatorSeq = 0;
            let indicatorTimer: number | null = null;
            const noteIdFacet = editorControl.joplinExtensions?.noteIdFacet;
            const indicator = new BacklinkIndicator(view, () => {
                void context.postMessage({ type: 'openPanel' } as ContentScriptToPluginMessage);
            });

            const resolveNoteId = (): string | null => {
                if (!noteIdFacet) {
                    return null;
                }
                try {
                    const value = view.state.facet(noteIdFacet);
                    if (Array.isArray(value)) {
                        const candidate = value[0];
                        return typeof candidate === 'string' && candidate ? candidate : null;
                    }
                    return typeof value === 'string' && value ? value : null;
                } catch (error) {
                    logger.warn('Failed to resolve active note id from facet', error);
                    return null;
                }
            };

            // Shows the indicator if it has a positive cached count and the panel isn't open
            // (the panel occupies the same top-right corner).
            const syncIndicator = (): void => {
                if (panel?.isOpen()) {
                    indicator.hide();
                    return;
                }
                const backlinks = currentNoteBacklinks?.length ?? 0;
                const outgoing = currentNoteOutgoing?.length ?? 0;
                if (backlinks + outgoing > 0) {
                    indicator.show({ backlinks, outgoing });
                } else {
                    indicator.hide();
                }
            };

            const closePanel = (focusEditor = false): void => {
                requestSeq += 1; // Invalidate any in-flight request.
                panel?.destroy();
                panel = null;
                if (focusEditor) {
                    view.focus();
                }
                syncIndicator();
            };

            const navigateTo = async (
                link: LinkItem,
                mode: 'current' | 'ctrlClick' | 'ctrlEnter' = 'current'
            ): Promise<void> => {
                if (mode !== 'current') {
                    const message: ContentScriptToPluginMessage = {
                        type: 'openNote',
                        noteId: link.noteId,
                        mode,
                    };
                    try {
                        await context.postMessage(message);
                    } catch (error) {
                        logger.error('Failed to open link with alternate behavior', { mode, error });
                    }
                    return;
                }

                // For a backlink, record where to scroll once the target note loads: the occurrence
                // that links back to the note we're currently viewing (`:/<currentNoteId>`). Outgoing
                // links just open the target note (there's no reference-back to scroll to).
                const currentNoteId = resolveNoteId();
                pendingScroll =
                    link.direction === 'in' && currentNoteId
                        ? {
                              targetNoteId: link.noteId,
                              needle: `:/${currentNoteId}`,
                              occurrenceIndex: link.occurrenceIndex,
                          }
                        : null;

                const message: ContentScriptToPluginMessage = { type: 'openNote', noteId: link.noteId };
                closePanel(false);
                try {
                    await context.postMessage(message);
                } catch (error) {
                    logger.error('Failed to navigate to link', error);
                    pendingScroll = null;
                }
            };

            const findOccurrencePosition = (text: string, needle: string, occurrenceIndex: number): number => {
                let fromIndex = 0;
                let remainingOccurrences = occurrenceIndex;

                while (fromIndex < text.length) {
                    const pos = text.indexOf(needle, fromIndex);
                    if (pos === -1) {
                        return -1;
                    }
                    if (remainingOccurrences === 0) {
                        return pos;
                    }
                    remainingOccurrences -= 1;
                    fromIndex = pos + needle.length;
                }

                return -1;
            };

            // Scrolls the (just-loaded) target note to the selected occurrence containing `needle`.
            // The note content may not be present the instant the id changes, so retry briefly.
            const scrollToReference = (targetNoteId: string, needle: string, occurrenceIndex: number): void => {
                const MAX_ATTEMPTS = 15;
                const RETRY_DELAY_MS = 80;
                let attempt = 0;

                const doScroll = (highlightRange: MarkdownLinkRange): void => {
                    const scrollPosition = highlightRange.from;
                    try {
                        view.dispatch({
                            selection: EditorSelection.cursor(scrollPosition),
                            effects: [
                                EditorView.scrollIntoView(scrollPosition, { y: 'center' }),
                                setReferenceHighlightEffect.of(highlightRange),
                            ],
                        });
                    } catch (error) {
                        logger.warn('Failed to scroll to backlink reference', error);
                    }
                };

                const tryScroll = (): void => {
                    // Bail if the user navigated away again before the content settled.
                    if (resolveNoteId() !== targetNoteId) {
                        return;
                    }

                    const text = view.state.doc.toString();
                    const pos = findOccurrencePosition(text, needle, occurrenceIndex);
                    if (pos === -1) {
                        attempt += 1;
                        if (attempt <= MAX_ATTEMPTS) {
                            window.setTimeout(tryScroll, RETRY_DELAY_MS);
                        }
                        return;
                    }

                    const highlightRange = findMarkdownLinkRange(text, pos, needle.length);
                    doScroll(highlightRange);
                    // Re-assert once after Joplin's own post-load cursor/scroll restoration.
                    window.setTimeout(() => {
                        if (resolveNoteId() === targetNoteId) {
                            doScroll(highlightRange);
                        }
                    }, 150);
                };

                window.setTimeout(tryScroll, 0);
            };

            const handleNoteChange = (noteId: string): void => {
                // New note: drop the stale caches (and their indicator) before closing the panel.
                currentNoteBacklinks = null;
                currentNoteOutgoing = null;
                closePanel(false);

                if (pendingScroll) {
                    const target = pendingScroll;
                    pendingScroll = null;
                    if (noteId === target.targetNoteId) {
                        scrollToReference(target.targetNoteId, target.needle, target.occurrenceIndex);
                    }
                }

                scheduleIndicatorRefresh();
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
                            onClose: (reason: PanelCloseReason) => {
                                closePanel(reason === 'escape');
                            },
                        },
                        panelSettings,
                        isMobile
                    );
                }
                return panel;
            };

            const loadBacklinks = async (noteId: string, seq: number): Promise<void> => {
                const message: ContentScriptToPluginMessage = { type: 'getBacklinks', noteId };
                try {
                    const response = (await context.postMessage(message)) as GetBacklinksResponse;
                    // Ignore if the panel was closed/re-opened while we awaited.
                    if (seq !== requestSeq || !panel?.isOpen()) {
                        return;
                    }
                    const backlinks = Array.isArray(response) ? response : [];
                    panel.setLinks('in', backlinks);
                    // Keep the badge's count fresh, but only when the indicator is enabled
                    // (a non-null cache is the proxy for "enabled").
                    if (currentNoteBacklinks !== null) {
                        currentNoteBacklinks = backlinks;
                    }
                } catch (error) {
                    logger.error('Failed to load backlinks', error);
                    if (seq === requestSeq && panel?.isOpen()) {
                        panel.setError('in', 'Failed to load backlinks');
                    }
                }
            };

            const loadOutgoing = async (noteId: string, seq: number): Promise<void> => {
                const message: ContentScriptToPluginMessage = { type: 'getOutgoingLinks', noteId };
                try {
                    const response = (await context.postMessage(message)) as GetOutgoingLinksResponse;
                    if (seq !== requestSeq || !panel?.isOpen()) {
                        return;
                    }
                    const outgoing = Array.isArray(response) ? response : [];
                    panel.setLinks('out', outgoing);
                    // Keep the badge's count fresh, but only when the indicator is enabled
                    // (a non-null cache is the proxy for "enabled").
                    if (currentNoteOutgoing !== null) {
                        currentNoteOutgoing = outgoing;
                    }
                } catch (error) {
                    logger.error('Failed to load outgoing links', error);
                    if (seq === requestSeq && panel?.isOpen()) {
                        panel.setError('out', 'Failed to load outgoing links');
                    }
                }
            };

            const openPanel = (isMobile: boolean): void => {
                const noteId = resolveNoteId();
                const activePanel = ensurePanel(isMobile);
                activePanel.open();
                indicator.hide(); // The panel occupies the indicator's corner.

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
                void loadBacklinks(noteId, seq);
                void loadOutgoing(noteId, seq);
            };

            const refreshIndicator = async (attempt = 0): Promise<void> => {
                const noteId = resolveNoteId();
                if (!noteId) {
                    // The facet may not be populated yet right after the editor loads.
                    if (attempt < 5) {
                        window.setTimeout(() => void refreshIndicator(attempt + 1), 150);
                    }
                    return;
                }

                const seq = ++indicatorSeq;
                let state: IndicatorState;
                try {
                    state = (await context.postMessage({
                        type: 'getIndicatorState',
                        noteId,
                    } as ContentScriptToPluginMessage)) as IndicatorState;
                } catch (error) {
                    logger.warn('Failed to fetch backlink indicator state', error);
                    return;
                }

                // Ignore if the note changed or another refresh superseded this one.
                if (seq !== indicatorSeq || resolveNoteId() !== noteId) {
                    return;
                }

                currentNoteBacklinks = state?.enabled ? (Array.isArray(state.backlinks) ? state.backlinks : []) : null;
                currentNoteOutgoing = state?.enabled ? (Array.isArray(state.outgoing) ? state.outgoing : []) : null;
                syncIndicator();
            };

            const scheduleIndicatorRefresh = (): void => {
                if (indicatorTimer !== null) {
                    clearTimeout(indicatorTimer);
                }
                indicatorTimer = window.setTimeout(() => {
                    indicatorTimer = null;
                    void refreshIndicator();
                }, INDICATOR_DEBOUNCE_MS);
            };

            const normalizeIncomingPanelSettings = (settings?: PanelSettings | PanelDimensions): PanelSettings => {
                if (settings && 'dimensions' in settings) {
                    return {
                        dimensions: normalizePanelDimensions(settings.dimensions),
                        preview: {
                            ...DEFAULT_LINK_PREVIEW_SETTINGS,
                            ...settings.preview,
                        },
                    };
                }
                return {
                    dimensions: normalizePanelDimensions(settings),
                    preview: { ...DEFAULT_LINK_PREVIEW_SETTINGS },
                };
            };

            const togglePanel = (settings?: PanelSettings | PanelDimensions, isMobile?: boolean): void => {
                if (settings) {
                    panelSettings = normalizeIncomingPanelSettings(settings);
                    panel?.setSettings(panelSettings);
                }

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
            editorControl.addExtension(referenceHighlightExtension);

            editorControl.registerCommand(EDITOR_COMMAND_TOGGLE_PANEL, togglePanel);

            // Check the initial note (the watcher only fires on subsequent switches).
            scheduleIndicatorRefresh();
        },
    };
}
