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

import { EditorView } from '@codemirror/view';
import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import { EDITOR_COMMAND_TOGGLE_PANEL } from '../constants';
import type { BacklinkItem, PanelDimensions } from '../types';
import type { ContentScriptToPluginMessage, GetBacklinksResponse } from '../messages';
import { normalizePanelDimensions } from '../panelDimensions';
import { BacklinksPanel, type PanelCloseReason } from './ui/backlinksPanel';
import { createNoteIdWatcher } from './ui/noteIdWatcher';
import logger from '../logger';

export default function backlinksNavigator(context: ContentScriptContext): MarkdownEditorContentScriptModule {
    return {
        plugin: (editorControl: CodeMirrorControl) => {
            // Extensions and listeners are scoped to this EditorView instance. When Joplin
            // destroys the editor (note close, plugin disable), they are cleaned up automatically.
            const view = editorControl.editor as EditorView;
            let panel: BacklinksPanel | null = null;
            let panelDimensions: PanelDimensions = normalizePanelDimensions();
            // Monotonic token so a slow backlink response can't populate a stale/closed panel.
            let requestSeq = 0;
            const noteIdFacet = editorControl.joplinExtensions?.noteIdFacet;

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

            const closePanel = (focusEditor = false): void => {
                requestSeq += 1; // Invalidate any in-flight request.
                panel?.destroy();
                panel = null;
                if (focusEditor) {
                    view.focus();
                }
            };

            const navigateTo = async (backlink: BacklinkItem): Promise<void> => {
                const message: ContentScriptToPluginMessage = { type: 'openNote', noteId: backlink.id };
                closePanel(false);
                try {
                    await context.postMessage(message);
                } catch (error) {
                    logger.error('Failed to navigate to backlink', error);
                }
            };

            const ensurePanel = (isMobile: boolean): BacklinksPanel => {
                if (!panel) {
                    panel = new BacklinksPanel(
                        view,
                        {
                            onSelect: (backlink) => {
                                void navigateTo(backlink);
                            },
                            onClose: (reason: PanelCloseReason) => {
                                closePanel(reason === 'escape');
                            },
                        },
                        panelDimensions,
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
                    panel.setBacklinks(Array.isArray(response) ? response : []);
                } catch (error) {
                    logger.error('Failed to load backlinks', error);
                    if (seq === requestSeq && panel?.isOpen()) {
                        panel.setError('Failed to load backlinks');
                    }
                }
            };

            const openPanel = (isMobile: boolean): void => {
                const noteId = resolveNoteId();
                const activePanel = ensurePanel(isMobile);
                activePanel.open();

                if (!noteId) {
                    activePanel.setError('Could not determine the current note');
                    return;
                }

                requestSeq += 1;
                void loadBacklinks(noteId, requestSeq);
            };

            const togglePanel = (dimensions?: PanelDimensions, isMobile?: boolean): void => {
                if (dimensions) {
                    panelDimensions = normalizePanelDimensions(dimensions);
                    panel?.setOptions(panelDimensions);
                }

                if (panel?.isOpen()) {
                    closePanel(true);
                } else {
                    openPanel(isMobile ?? false);
                }
            };

            // Close the panel when the user switches notes (backlinks are note-specific).
            if (noteIdFacet) {
                editorControl.addExtension(createNoteIdWatcher(noteIdFacet, () => closePanel(false)));
            }

            editorControl.registerCommand(EDITOR_COMMAND_TOGGLE_PANEL, togglePanel);
        },
    };
}
