/**
 * Backlinks Navigator plugin entry point.
 *
 * Runs in the Joplin plugin host context and only wires the plugin together: it registers the
 * settings, the CodeMirror content script and its message handler, the commands, and the menu and
 * toolbar entries that open the panel.
 *
 * Architecture:
 * - Plugin host (this file and host/): Joplin API access, handles privileged operations
 * - Content script (contentScripts/backlinksNavigator.ts): CodeMirror access, renders the panel
 * - Communication: request/response via the postMessage bridge (see messages.ts and
 *   host/messageHandler.ts)
 */

import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import {
    CODEMIRROR_CONTENT_SCRIPT_ID,
    COMMAND_SHOW_BACKLINKS,
    COMMAND_TOGGLE_IGNORE_NOTEBOOK,
    EDITOR_COMMAND_TOGGLE_PANEL,
    EDITOR_COMMAND_UPDATE_SETTINGS,
} from './constants';
import logger from './logger';
import {
    DEBUG_SETTING_KEY,
    isEditorAffectingSettingChanged,
    loadContentScriptSettings,
    loadDebugSetting,
    registerSettings,
} from './host/settings';
import { toggleIgnoredNotebook } from './host/ignoredNotebooks';
import { JoplinRepository, type LinkRepository } from './host/joplinRepository';
import { createMessageHandler } from './host/messageHandler';

/**
 * Desktop when-clause: true only when the CodeMirror (markdown) editor pane is shown,
 * i.e. not in the Rich Text editor and not in viewer-only layout.
 *
 * Not used on mobile: the mobile note toolbar menu caches its enabled state and doesn't
 * refresh it when switching between the viewer and editor, so the button is placed in
 * the editor toolbar there instead (which only shows in the markdown editor).
 */
const DESKTOP_ENABLED_CONDITION = 'markdownEditorPaneVisible';

async function isMobilePlatform(): Promise<boolean> {
    const versionInfo = await joplin.versionInfo();
    return versionInfo.platform === 'mobile';
}

async function registerContentScripts(repository: LinkRepository): Promise<void> {
    await joplin.contentScripts.register(
        ContentScriptType.CodeMirrorPlugin,
        CODEMIRROR_CONTENT_SCRIPT_ID,
        './contentScripts/backlinksNavigator.js'
    );

    await joplin.contentScripts.onMessage(CODEMIRROR_CONTENT_SCRIPT_ID, createMessageHandler(repository));
}

async function registerCommands(repository: LinkRepository, isMobile: boolean): Promise<void> {
    await joplin.commands.register({
        name: COMMAND_TOGGLE_IGNORE_NOTEBOOK,
        label: 'Toggle Backlinks Navigator ignore',
        execute: (folderId: string) => toggleIgnoredNotebook(repository, folderId),
    });

    await joplin.commands.register({
        name: COMMAND_SHOW_BACKLINKS,
        label: 'Show Links',
        iconName: 'fas fa-link',
        enabledCondition: isMobile ? undefined : DESKTOP_ENABLED_CONDITION,
        execute: async () => {
            logger.info('Show Backlinks command triggered');

            await joplin.commands.execute('editor.execCommand', {
                name: EDITOR_COMMAND_TOGGLE_PANEL,
                args: [isMobile],
            });
        },
    });
}

async function pushContentScriptSettings(): Promise<void> {
    const settings = await loadContentScriptSettings();
    try {
        await joplin.commands.execute('editor.execCommand', {
            name: EDITOR_COMMAND_UPDATE_SETTINGS,
            args: [settings],
        });
    } catch (error) {
        logger.warn('Failed to push updated content script settings', error);
    }
}

async function registerMenuItems(): Promise<void> {
    await joplin.views.menuItems.create('backlinksNavigatorMenuItem', COMMAND_SHOW_BACKLINKS, MenuItemLocation.Edit);
    // Notebook ids have no copy affordance in Joplin's UI, so this is how the ignore list is built.
    await joplin.views.menuItems.create(
        'backlinksNavigatorIgnoreNotebookMenuItem',
        COMMAND_TOGGLE_IGNORE_NOTEBOOK,
        MenuItemLocation.FolderContextMenu
    );
}

async function registerToolbarButton(isMobile: boolean): Promise<void> {
    const location = isMobile ? ToolbarButtonLocation.EditorToolbar : ToolbarButtonLocation.NoteToolbar;
    await joplin.views.toolbarButtons.create('backlinksNavigatorToolbarButton', COMMAND_SHOW_BACKLINKS, location);
}

async function applyDebugSetting(): Promise<void> {
    logger.setDebug(await loadDebugSetting());
}

async function handleSettingsChange(keys: string[]): Promise<void> {
    try {
        if (keys.includes(DEBUG_SETTING_KEY)) {
            await applyDebugSetting();
        }
        if (isEditorAffectingSettingChanged(keys)) {
            await pushContentScriptSettings();
        }
    } catch (error) {
        logger.error('Failed to apply setting change', error);
    }
}

void joplin.plugins.register({
    onStart: async () => {
        logger.info('Backlinks Navigator plugin starting');
        const repository = new JoplinRepository(joplin.data);
        const isMobile = await isMobilePlatform();
        await registerSettings();
        await applyDebugSetting();
        await joplin.settings.onChange(({ keys }) => {
            void handleSettingsChange(keys);
        });
        await registerContentScripts(repository);
        await registerCommands(repository, isMobile);
        await registerMenuItems();
        await registerToolbarButton(isMobile);
    },
});
