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
    COMMAND_TOGGLE_IGNORE_NOTEBOOK,
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
    loadMiddleClickBehaviorSetting,
    loadShowIndicatorSetting,
    registerSettings,
    setIgnoredNotebookIdsSetting,
} from './host/settings';
import type {
    AlternateOpenMode,
    ContentScriptToPluginMessage,
    GetBacklinksResponse,
    GetContentScriptSettingsResponse,
    GetOutgoingLinksResponse,
    IndicatorState,
} from './messages';
import { countBacklinks, findBacklinks } from './host/backlinksService';
import { JoplinRepository, type JoplinDataApi } from './host/joplinRepository';
import { countOutgoingLinks, findOutgoingLinks } from './host/outgoingLinksService';
import { expandIgnoredFolderIds, resolveNotebookName } from './host/noteMetadata';
import type { BacklinkOpenBehavior, LinkFilters } from './types';

type ResolvedOpenNoteMode = 'current' | BacklinkOpenBehavior;

/** Each alternate gesture reads its own behavior setting. */
const ALTERNATE_MODE_LOADERS: Record<AlternateOpenMode, () => Promise<BacklinkOpenBehavior>> = {
    ctrlClick: loadCtrlClickBehaviorSetting,
    ctrlEnter: loadCtrlEnterBehaviorSetting,
    middleClick: loadMiddleClickBehaviorSetting,
};

async function showToast(message: string, type: ToastType = ToastType.Error): Promise<void> {
    try {
        await joplin.views.dialogs.showToast({ message, type });
    } catch (error) {
        logger.warn('Failed to show toast notification', error);
    }
}

async function resolveOpenNoteMode(message: ContentScriptToPluginMessage): Promise<ResolvedOpenNoteMode> {
    if (message.type !== 'openNote' || !message.mode) {
        return 'current';
    }
    return ALTERNATE_MODE_LOADERS[message.mode]();
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
                await showToast('Failed to open backlink in new window');
            }
            return;
        case 'newTab':
            try {
                await joplin.commands.execute('tabsPinNote', [noteId]);
                logger.debug('Opened backlink in Note Tabs tab', { noteId });
            } catch (error) {
                logger.error('Failed to open backlink in Note Tabs tab', { noteId, error });
                await showToast('Opening backlinks in new tabs requires the Note Tabs plugin.');
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
async function loadLinkFilters(repository: JoplinRepository): Promise<LinkFilters> {
    const [ignoredNoteIds, configuredFolderIds] = await Promise.all([
        loadIgnoredBacklinkNoteIdsSetting(),
        loadIgnoredNotebookIdsSetting(),
    ]);
    return { ignoredNoteIds, ignoredFolderIds: await expandIgnoredFolderIds(repository, configuredFolderIds) };
}

async function findBacklinksWithSettings(repository: JoplinRepository, noteId: string): Promise<GetBacklinksResponse> {
    return findBacklinks(repository, noteId, await loadLinkFilters(repository));
}

async function findOutgoingLinksWithSettings(
    repository: JoplinRepository,
    noteId: string
): Promise<GetOutgoingLinksResponse> {
    return findOutgoingLinks(repository, noteId, await loadLinkFilters(repository));
}

async function handleMessage(
    repository: JoplinRepository,
    message: ContentScriptToPluginMessage
): Promise<GetBacklinksResponse | GetOutgoingLinksResponse | GetContentScriptSettingsResponse | IndicatorState | void> {
    if (!message || typeof message !== 'object') {
        return;
    }

    switch (message.type) {
        case 'getBacklinks':
            return findBacklinksWithSettings(repository, message.noteId);
        case 'getOutgoingLinks':
            return findOutgoingLinksWithSettings(repository, message.noteId);
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
            const filters = await loadLinkFilters(repository);
            const [backlinks, outgoing] = await Promise.all([
                countBacklinks(repository, message.noteId, filters),
                countOutgoingLinks(repository, message.noteId, filters),
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

async function registerContentScripts(repository: JoplinRepository): Promise<void> {
    await joplin.contentScripts.register(
        ContentScriptType.CodeMirrorPlugin,
        CODEMIRROR_CONTENT_SCRIPT_ID,
        './contentScripts/backlinksNavigator.js'
    );

    await joplin.contentScripts.onMessage(CODEMIRROR_CONTENT_SCRIPT_ID, (message: ContentScriptToPluginMessage) =>
        handleMessage(repository, message)
    );
}

/**
 * Adds or removes the right-clicked notebook from the ignore list.
 *
 * Joplin's menu items carry no per-item checked state and their labels are fixed at registration,
 * so one toggle plus a toast is the only way to show which way the switch flipped.
 *
 * @param folderId - Supplied by the folder context menu. Empty when the command is run from the
 *   command palette, where there is no notebook in context.
 */
async function toggleIgnoredNotebook(repository: JoplinRepository, folderId: string): Promise<void> {
    if (!folderId) {
        logger.debug('Ignore-notebook command invoked without a notebook');
        return;
    }

    // The setting stores lowercased ids, so match that before adding or removing.
    const notebookId = folderId.toLowerCase();
    const ignored = await loadIgnoredNotebookIdsSetting();
    const nowIgnored = !ignored.delete(notebookId);
    if (nowIgnored) {
        ignored.add(notebookId);
    }
    // Writing the setting fires onChange, which refreshes the indicator.
    await setIgnoredNotebookIdsSetting(ignored);

    const notebookName = (await resolveNotebookName(repository, folderId, new Map())) || 'this notebook';
    logger.info('Toggled ignored notebook', { folderId, nowIgnored });
    await showToast(
        nowIgnored ? `Ignoring links in "${notebookName}"` : `No longer ignoring links in "${notebookName}"`,
        ToastType.Info
    );
}

async function registerCommands(repository: JoplinRepository): Promise<void> {
    await joplin.commands.register({
        name: COMMAND_TOGGLE_IGNORE_NOTEBOOK,
        label: 'Toggle Backlinks Navigator ignore',
        execute: (folderId: string) => toggleIgnoredNotebook(repository, folderId),
    });

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
    // Notebook ids have no copy affordance in Joplin's UI, so this is how the ignore list is built.
    await joplin.views.menuItems.create(
        'backlinksNavigatorIgnoreNotebookMenuItem',
        COMMAND_TOGGLE_IGNORE_NOTEBOOK,
        MenuItemLocation.FolderContextMenu
    );
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
        const repository = new JoplinRepository(joplin.data as unknown as JoplinDataApi);
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
        await registerContentScripts(repository);
        await registerCommands(repository);
        await registerMenuItems();
        await registerToolbarButton();
    },
});
