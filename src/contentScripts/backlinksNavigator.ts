/**
 * Backlinks Navigator content script for CodeMirror 6.
 *
 * Runs in the editor context (CodeMirror access, no direct Joplin API) and wires one editor view
 * together: it reads the current note id from Joplin's note-id facet, connects the popup and the
 * badge, registers the editor commands the host runs, and reacts to note switches.
 *
 * See:
 * - panelController.ts - The popup: loading rows, navigation, and post-navigation scrolling
 * - indicatorController.ts - The badge: counts and refresh scheduling
 * - host/messageHandler.ts - Plugin host that resolves links and performs navigation
 * - messages.ts - Message protocol
 */

import { type EditorView, ViewPlugin } from '@codemirror/view';
import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import { EDITOR_COMMAND_TOGGLE_PANEL, EDITOR_COMMAND_UPDATE_SETTINGS } from '../commandIds';
import type { ContentScriptSettings } from '../types';
import { IndicatorController } from './indicatorController';
import { PanelController } from './panelController';
import { createNoteIdWatcher, type NoteIdFacet } from './editor/noteIdWatcher';
import { referenceHighlightExtension } from './editor/referenceHighlight';
import {
    applyContentScriptSettings,
    createSettingsExtension,
    syncInitialContentScriptSettings,
} from './editor/pluginSettings';
import logger from '../logger';

export default function backlinksNavigator(context: ContentScriptContext): MarkdownEditorContentScriptModule {
    return {
        plugin: (editorControl: CodeMirrorControl) => {
            // Extensions and listeners are scoped to this EditorView instance. When Joplin
            // destroys the editor (note close, plugin disable), they are cleaned up automatically.
            const view = editorControl.editor as EditorView;
            const noteIdFacet = editorControl.joplinExtensions.noteIdFacet as NoteIdFacet | undefined;
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

            // The panel and the badge share the editor's top-right corner: the badge hides while the
            // panel is open, and the panel's freshly loaded rows refresh the badge's cached counts,
            // so clicking the badge brings it up to date too.
            const panel = new PanelController(view, context, {
                resolveNoteId,
                onVisibilityChange: () => indicator.sync(),
                onLinksLoaded: (direction, links) => indicator.recordLinks(direction, links),
            });
            const indicator = new IndicatorController(view, context, {
                resolveNoteId,
                isPanelOpen: () => panel.isOpen(),
            });

            const handleNoteChange = (noteId: string): void => {
                // New note: drop the stale counts (and their badge) before closing the panel.
                indicator.reset();
                panel.handleNoteChange(noteId);
                indicator.scheduleRefresh();
            };

            const applySettingsUpdate = (settings: ContentScriptSettings): void => {
                applyContentScriptSettings(view, settings);
                panel.setSettings(settings.panel);
                if (!settings.showIndicator) {
                    indicator.reset();
                    return;
                }
                indicator.sync();
                indicator.scheduleRefresh();
            };

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
            editorControl.registerCommand(EDITOR_COMMAND_TOGGLE_PANEL, (isMobile?: boolean) => panel.toggle(isMobile));

            // Check the initial note after settings arrive (the watcher only fires on subsequent switches).
            void syncInitialContentScriptSettings(context, view).finally(() => indicator.scheduleRefresh());
        },
    };
}
