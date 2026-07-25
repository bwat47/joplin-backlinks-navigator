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
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import { EDITOR_COMMAND_TOGGLE_PANEL, EDITOR_COMMAND_UPDATE_SETTINGS } from '../constants';
import type { LinkCounts, LinkItem } from '../types';
import { EMPTY_LINK_COUNTS } from '../types';
import {
    findHeadingByAnchor,
    findHtmlAnchorById,
    findOccurrenceOffsets,
    parseHtmlAnchors,
    parseMarkdownHeadings,
    type HtmlAnchor,
    type MarkdownHeading,
} from '../linkExtraction';
import type {
    ContentScriptToPluginMessage,
    GetBacklinksResponse,
    GetOutgoingLinksResponse,
    IndicatorState,
} from '../messages';
import { getDisplayCounts, toBacklinkCounts } from '../linkDisplay';
import { BacklinksPanel, type PanelCloseReason } from './ui/backlinksPanel';
import { BacklinkIndicator } from './ui/backlinkIndicator';
import { createNoteIdWatcher } from './ui/noteIdWatcher';
import { findMarkdownLinkRange, type MarkdownLinkRange } from './markdownLinkPosition';
import { referenceHighlightExtension, setReferenceHighlightEffect } from './referenceHighlight';
import {
    applyContentScriptSettings,
    createSettingsExtension,
    getContentScriptSettings,
    syncInitialContentScriptSettings,
} from './pluginSettings';
import logger from '../logger';

const INDICATOR_DEBOUNCE_MS = 350;

/**
 * Where to scroll the target note once it loads, recorded before navigating away.
 *
 * - `reference` — a backlink: the occurrence of `needle` (`:/<currentNoteId>`) that links back to
 *   the note we came from.
 * - `anchor` — an outgoing link to an anchor: the heading that anchor names, or the explicit HTML
 *   anchor (`<a id="…">`) it points at.
 */
type PendingScroll = { targetNoteId: string } & (
    | { kind: 'reference'; needle: string; occurrenceIndex: number }
    | { kind: 'anchor'; anchor: string }
);

/** Coerces one count from a bridge payload to a non-negative integer. */
function readCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Validates {@link LinkCounts} arriving over the postMessage bridge. */
function normalizeLinkCounts(counts: unknown): LinkCounts {
    const candidate = (counts ?? {}) as Partial<Record<keyof LinkCounts, unknown>>;
    return {
        backlinkOccurrences: readCount(candidate.backlinkOccurrences),
        backlinkNotes: readCount(candidate.backlinkNotes),
        outgoing: readCount(candidate.outgoing),
    };
}

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
            // Counts backing the indicator badge. The panel always fetches fresh rows and does not
            // read this cache; it only refreshes it from what it loaded.
            let indicatorEnabled = false;
            let indicatorCounts: LinkCounts = EMPTY_LINK_COUNTS;
            let indicatorSeq = 0;
            let indicatorTimer: number | null = null;
            let disposed = false;
            const noteIdFacet = editorControl.joplinExtensions?.noteIdFacet;
            const indicator = new BacklinkIndicator(view, () => {
                void context.postMessage({ type: 'openPanel' } as ContentScriptToPluginMessage);
            });

            const clearIndicatorCache = (): void => {
                indicatorEnabled = false;
                indicatorCounts = EMPTY_LINK_COUNTS;
            };

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
                if (disposed) {
                    return;
                }
                const settings = getContentScriptSettings(view.state);
                if (panel?.isOpen()) {
                    indicator.hide();
                    return;
                }
                if (!indicatorEnabled) {
                    indicator.hide();
                    return;
                }
                const counts = getDisplayCounts(indicatorCounts, settings.panel.preview);
                if (counts.backlinks + counts.outgoing > 0) {
                    indicator.show(counts);
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
                // Only outgoing rows carry an anchor; a backlink's anchor (if any) points into the
                // note we're already viewing.
                const anchor = link.direction === 'out' ? link.anchor : '';

                if (mode !== 'current') {
                    const message: ContentScriptToPluginMessage = {
                        type: 'openNote',
                        noteId: link.noteId,
                        anchor,
                        mode,
                    };
                    try {
                        await context.postMessage(message);
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
                        needle: `:/${currentNoteId}`,
                        occurrenceIndex: link.occurrenceIndex,
                    };
                } else {
                    pendingScroll = null;
                }

                const message: ContentScriptToPluginMessage = { type: 'openNote', noteId: link.noteId, anchor };
                closePanel(false);
                try {
                    await context.postMessage(message);
                } catch (error) {
                    logger.error('Failed to navigate to link', error);
                    pendingScroll = null;
                }
            };

            // Resolves the range to place the cursor at and highlight in the just-loaded note.
            // Returns null while the target can't be found (the note content may not have settled).
            const resolveScrollRange = (
                target: PendingScroll,
                text: string,
                headings: readonly MarkdownHeading[] = [],
                htmlAnchors: readonly HtmlAnchor[] = []
            ): MarkdownLinkRange | null => {
                if (target.kind === 'anchor') {
                    // A heading slug wins over an explicit HTML anchor with the same name, matching
                    // how the row's label/preview were resolved on the host side.
                    const heading = findHeadingByAnchor(headings, target.anchor);
                    if (heading) {
                        return { from: heading.from, to: heading.to };
                    }
                    const htmlAnchor = findHtmlAnchorById(htmlAnchors, target.anchor);
                    return htmlAnchor ? { from: htmlAnchor.from, to: htmlAnchor.to } : null;
                }
                const pos = findOccurrenceOffsets(text, target.needle)[target.occurrenceIndex] ?? -1;
                return pos === -1 ? null : findMarkdownLinkRange(text, pos, target.needle.length);
            };

            // Scrolls the (just-loaded) target note to the spot the selected row stands for.
            // The note content may not be present the instant the id changes, so retry briefly.
            const scrollToTarget = (target: PendingScroll): void => {
                const MAX_ATTEMPTS = 15;
                const RETRY_DELAY_MS = 80;
                let attempt = 0;
                let parsedAnchorText: string | null = null;
                let parsedHeadings: MarkdownHeading[] = [];
                let parsedHtmlAnchors: HtmlAnchor[] = [];

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
                        logger.warn('Failed to scroll to link target', error);
                    }
                };

                const tryScroll = (): void => {
                    // Bail if the user navigated away again before the content settled.
                    if (resolveNoteId() !== target.targetNoteId) {
                        return;
                    }

                    const text = view.state.doc.toString();
                    if (target.kind === 'anchor' && text !== parsedAnchorText) {
                        parsedAnchorText = text;
                        parsedHeadings = parseMarkdownHeadings(text);
                        parsedHtmlAnchors = parseHtmlAnchors(text);
                    }
                    const highlightRange = resolveScrollRange(target, text, parsedHeadings, parsedHtmlAnchors);
                    if (!highlightRange) {
                        attempt += 1;
                        if (attempt <= MAX_ATTEMPTS) {
                            window.setTimeout(tryScroll, RETRY_DELAY_MS);
                        }
                        return;
                    }

                    doScroll(highlightRange);
                    // Re-assert once after Joplin's own post-load cursor/scroll restoration.
                    window.setTimeout(() => {
                        if (resolveNoteId() === target.targetNoteId) {
                            doScroll(highlightRange);
                        }
                    }, 150);
                };

                window.setTimeout(tryScroll, 0);
            };

            const handleNoteChange = (noteId: string): void => {
                // New note: drop the stale caches (and their indicator) before closing the panel.
                clearIndicatorCache();
                closePanel(false);

                if (pendingScroll) {
                    const target = pendingScroll;
                    pendingScroll = null;
                    if (noteId === target.targetNoteId) {
                        scrollToTarget(target);
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
                        getContentScriptSettings(view.state).panel,
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
                    // Keep the badge's count fresh, but only when the indicator is enabled.
                    if (indicatorEnabled) {
                        indicatorCounts = { ...indicatorCounts, ...toBacklinkCounts(backlinks) };
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
                    // Keep the badge's count fresh, but only when the indicator is enabled.
                    if (indicatorEnabled) {
                        indicatorCounts = { ...indicatorCounts, outgoing: outgoing.length };
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
                if (disposed) {
                    return;
                }
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
                    if (!disposed) {
                        logger.warn('Failed to fetch backlink indicator state', error);
                    }
                    return;
                }

                // Ignore if the editor was destroyed, the note changed, or another refresh
                // superseded this one.
                if (disposed || seq !== indicatorSeq || resolveNoteId() !== noteId) {
                    return;
                }

                if (state?.enabled) {
                    indicatorEnabled = true;
                    indicatorCounts = normalizeLinkCounts(state.counts);
                } else {
                    clearIndicatorCache();
                }
                syncIndicator();
            };

            const cancelIndicatorRefresh = (): void => {
                if (indicatorTimer !== null) {
                    clearTimeout(indicatorTimer);
                    indicatorTimer = null;
                }
            };

            const scheduleIndicatorRefresh = (): void => {
                if (disposed) {
                    return;
                }
                cancelIndicatorRefresh();
                indicatorTimer = window.setTimeout(() => {
                    indicatorTimer = null;
                    void refreshIndicator();
                }, INDICATOR_DEBOUNCE_MS);
            };

            const disposeIndicator = (): void => {
                if (disposed) {
                    return;
                }
                disposed = true;
                indicatorSeq += 1;
                cancelIndicatorRefresh();
                indicator.destroy();
            };

            const applySettingsUpdate = (settings: unknown): void => {
                const nextSettings = applyContentScriptSettings(view, settings);
                panel?.setSettings(nextSettings.panel);
                if (!nextSettings.showIndicator) {
                    clearIndicatorCache();
                    indicator.hide();
                    return;
                }
                syncIndicator();
                scheduleIndicatorRefresh();
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
            editorControl.addExtension(ViewPlugin.define(() => ({ destroy: disposeIndicator })));

            editorControl.registerCommand(EDITOR_COMMAND_UPDATE_SETTINGS, applySettingsUpdate);
            editorControl.registerCommand(EDITOR_COMMAND_TOGGLE_PANEL, togglePanel);

            // Check the initial note after settings arrive (the watcher only fires on subsequent switches).
            void syncInitialContentScriptSettings(context, view).finally(scheduleIndicatorRefresh);
        },
    };
}
