/**
 * Backlinks Navigator plugin entry point and host orchestrator.
 *
 * Runs in the Joplin plugin host context with full API access. It:
 * - Registers the CodeMirror content script (runs in the editor context)
 * - Answers messages from the content script (backlink lookup, note navigation)
 * - Registers the command, toolbar button, and menu item that open the panel
 * - Manages plugin settings
 *
 * Architecture:
 * - Plugin host (this file): Joplin API access, handles privileged operations
 * - Content script (contentScripts/backlinksNavigator.ts): CodeMirror access, renders the panel
 * - Communication: request/response via the postMessage bridge (see messages.ts)
 */

import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToastType, ToolbarButtonLocation } from 'api/types';
import {
    CODEMIRROR_CONTENT_SCRIPT_ID,
    COMMAND_SHOW_BACKLINKS,
    EDITOR_COMMAND_TOGGLE_PANEL,
    EDITOR_COMMAND_UPDATE_SETTINGS,
} from './constants';
import logger from './logger';
import {
    DEBUG_SETTING_KEY,
    isEditorAffectingSettingChanged,
    loadContentScriptSettings,
    loadCtrlClickBehaviorSetting,
    loadCtrlEnterBehaviorSetting,
    loadDebugSetting,
    loadIgnoredBacklinkNoteIdsSetting,
    loadIgnoredNotebookIdsSetting,
    loadShowIndicatorSetting,
    registerSettings,
} from './host/settings';
import type {
    ContentScriptToPluginMessage,
    GetBacklinksResponse,
    GetContentScriptSettingsResponse,
    GetOutgoingLinksResponse,
    IndicatorState,
} from './messages';
import { countBacklinks, findBacklinks } from './host/backlinksService';
import { countOutgoingLinks, findOutgoingLinks } from './host/outgoingLinksService';
import { expandIgnoredFolderIds } from './host/noteMetadata';
import type { BacklinkOpenBehavior, LinkFilters } from './types';

type ResolvedOpenNoteMode = 'current' | BacklinkOpenBehavior;

async function showErrorToast(message: string): Promise<void> {
    try {
        await joplin.views.dialogs.showToast({ message, type: ToastType.Error });
    } catch (error) {
        logger.warn('Failed to show toast notification', error);
    }
}

async function resolveOpenNoteMode(message: ContentScriptToPluginMessage): Promise<ResolvedOpenNoteMode> {
    if (message.type !== 'openNote') {
        return 'current';
    }
    if (message.mode === 'ctrlClick') {
        return loadCtrlClickBehaviorSetting();
    }
    if (message.mode === 'ctrlEnter') {
        return loadCtrlEnterBehaviorSetting();
    }
    return 'current';
}

/**
 * @param anchor - Heading slug to land on. Only honored in the current window: the new-window and
 *   Note Tabs commands take a note id alone, so those just open the note.
 */
async function openNote(noteId: string, mode: ResolvedOpenNoteMode, anchor = ''): Promise<void> {
    switch (mode) {
        case 'current':
            await joplin.commands.execute('openItem', anchor ? `:/${noteId}#${anchor}` : `:/${noteId}`);
            return;
        case 'newWindow':
            try {
                await joplin.commands.execute('openNoteInNewWindow', noteId);
                logger.debug('Opened backlink in new window', { noteId });
            } catch (error) {
                logger.error('Failed to open backlink in new window', { noteId, error });
                await showErrorToast('Failed to open backlink in new window');
            }
            return;
        case 'newTab':
            try {
                await joplin.commands.execute('tabsPinNote', [noteId]);
                logger.debug('Opened backlink in Note Tabs tab', { noteId });
            } catch (error) {
                logger.error('Failed to open backlink in Note Tabs tab', { noteId, error });
                await showErrorToast('Opening backlinks in new tabs requires the Note Tabs plugin.');
            }
            return;
        default:
            logger.warn('Received unsupported backlink open mode', mode);
    }
}

/**
 * Reads the configured exclusions and resolves the ignored notebooks against the notebook tree.
 *
 * Loaded once per request and shared by every discovery call it feeds, so the indicator's two
 * counters don't each pay for the folder listing.
 */
async function loadLinkFilters(): Promise<LinkFilters> {
    const [ignoredNoteIds, configuredFolderIds] = await Promise.all([
        loadIgnoredBacklinkNoteIdsSetting(),
        loadIgnoredNotebookIdsSetting(),
    ]);
    return { ignoredNoteIds, ignoredFolderIds: await expandIgnoredFolderIds(configuredFolderIds) };
}

async function findBacklinksWithSettings(noteId: string): Promise<GetBacklinksResponse> {
    return findBacklinks(noteId, await loadLinkFilters());
}

async function findOutgoingLinksWithSettings(noteId: string): Promise<GetOutgoingLinksResponse> {
    return findOutgoingLinks(noteId, await loadLinkFilters());
}

async function handleMessage(
    message: ContentScriptToPluginMessage
): Promise<GetBacklinksResponse | GetOutgoingLinksResponse | GetContentScriptSettingsResponse | IndicatorState | void> {
    if (!message || typeof message !== 'object') {
        return;
    }

    switch (message.type) {
        case 'getBacklinks':
            return findBacklinksWithSettings(message.noteId);
        case 'getOutgoingLinks':
            return findOutgoingLinksWithSettings(message.noteId);
        case 'getContentScriptSettings':
            return loadContentScriptSettings();
        case 'getIndicatorState': {
            // Honor the setting before doing any link discovery.
            if (!(await loadShowIndicatorSetting())) {
                return { enabled: false };
            }
            // The badge only renders counts, so count links instead of resolving rows: this skips
            // the snippet, notebook, and anchor work — including a body fetch and markdown parse
            // per outgoing target — on every note open.
            const filters = await loadLinkFilters();
            const [backlinks, outgoing] = await Promise.all([
                countBacklinks(message.noteId, filters),
                countOutgoingLinks(message.noteId, filters),
            ]);
            return {
                enabled: true,
                counts: {
                    backlinkOccurrences: backlinks.occurrences,
                    backlinkNotes: backlinks.notes,
                    outgoing,
                },
            };
        }
        case 'openNote':
            await openNote(message.noteId, await resolveOpenNoteMode(message), message.anchor);
            return;
        case 'openPanel':
            await joplin.commands.execute(COMMAND_SHOW_BACKLINKS);
            return;
        default:
            logger.warn('Received unsupported message from content script', message);
    }
}

async function registerContentScripts(): Promise<void> {
    await joplin.contentScripts.register(
        ContentScriptType.CodeMirrorPlugin,
        CODEMIRROR_CONTENT_SCRIPT_ID,
        './contentScripts/backlinksNavigator.js'
    );

    await joplin.contentScripts.onMessage(CODEMIRROR_CONTENT_SCRIPT_ID, handleMessage);
}

async function registerCommands(): Promise<void> {
    await joplin.commands.register({
        name: COMMAND_SHOW_BACKLINKS,
        label: 'Show Links',
        iconName: 'fas fa-link',
        execute: async () => {
            logger.info('Show Backlinks command triggered');
            const versionInfo = await joplin.versionInfo();
            const isMobile = versionInfo.platform === 'mobile';

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
}

async function registerToolbarButton(): Promise<void> {
    await joplin.views.toolbarButtons.create(
        'backlinksNavigatorToolbarButton',
        COMMAND_SHOW_BACKLINKS,
        ToolbarButtonLocation.EditorToolbar
    );
}

async function applyDebugSetting(): Promise<void> {
    logger.setDebug(await loadDebugSetting());
}

joplin.plugins.register({
    onStart: async () => {
        logger.info('Backlinks Navigator plugin starting');
        await registerSettings();
        await applyDebugSetting();
        await joplin.settings.onChange(async ({ keys }) => {
            if (keys.includes(DEBUG_SETTING_KEY)) {
                await applyDebugSetting();
            }
            if (isEditorAffectingSettingChanged(keys)) {
                await pushContentScriptSettings();
            }
        });
        await registerContentScripts();
        await registerCommands();
        await registerMenuItems();
        await registerToolbarButton();
    },
});
