/**
 * Joplin settings registration and loading for the links panel.
 *
 * Integrates panel configuration into Joplin's preferences UI.
 *
 * See:
 * - panelDimensions.ts - Validation and normalization utilities
 * - index.ts - Calls registerSettings() on startup and forwards loaded values
 */

import joplin from 'api';
import { SettingItemType } from 'api/types';
import logger from '../logger';
import type { BacklinkOpenBehavior, ContentScriptSettings, LinkPreviewMode, PanelSettings } from '../types';
import { DEFAULT_LINK_PREVIEW_SETTINGS, isLinkPreviewMode } from '../types';
import {
    DEFAULT_PANEL_HEIGHT_PERCENTAGE,
    DEFAULT_PANEL_WIDTH,
    MAX_PANEL_HEIGHT_PERCENTAGE,
    MAX_PANEL_WIDTH,
    MIN_PANEL_HEIGHT_PERCENTAGE,
    MIN_PANEL_WIDTH,
    normalizePanelHeightPercentage,
    normalizePanelWidth,
} from '../panelDimensions';

const SECTION_ID = 'backlinksNavigator';
const SETTING_PANEL_WIDTH = 'backlinksNavigator.panelWidth';
const SETTING_PANEL_MAX_HEIGHT = 'backlinksNavigator.panelMaxHeightPercentage';
const SETTING_SHOW_INDICATOR = 'backlinksNavigator.showIndicator';
const SETTING_IGNORED_BACKLINK_NOTE_IDS = 'backlinksNavigator.ignoredBacklinkNoteIds';
const SETTING_IGNORED_NOTEBOOK_IDS = 'backlinksNavigator.ignoredNotebookIds';
const SETTING_CTRL_CLICK_BEHAVIOR = 'backlinksNavigator.ctrlClickBehavior';
const SETTING_CTRL_ENTER_BEHAVIOR = 'backlinksNavigator.ctrlEnterBehavior';
const SETTING_BACKLINK_PREVIEW_MODE = 'backlinksNavigator.backlinkPreviewMode';
const SETTING_OUTGOING_PREVIEW_MODE = 'backlinksNavigator.outgoingPreviewMode';
const SETTING_DEBUG = 'backlinksNavigator.debug';
const DEFAULT_BACKLINK_OPEN_BEHAVIOR: BacklinkOpenBehavior = 'newWindow';
const BACKLINK_OPEN_BEHAVIOR_OPTIONS: Record<BacklinkOpenBehavior, string> = {
    newWindow: 'Open note in new window',
    newTab: 'Open note in Note Tabs tab',
};
const LINK_PREVIEW_MODE_OPTIONS: Record<LinkPreviewMode, string> = {
    title: 'Note Title',
    titleSnippet: 'Note Title + Snippet',
    titleSnippetHeading: 'Note Title + Snippet + Nearest Heading',
};
// Outgoing links preview the linked note's opening, which has no enclosing heading to show.
const OUTGOING_LINK_PREVIEW_MODE_OPTIONS: Record<'title' | 'titleSnippet', string> = {
    title: 'Note Title',
    titleSnippet: 'Note Title + Snippet',
};

/**
 * Matches one raw Joplin item id token, e.g. `bb12adaa3c704ff3bf09c0d7f7ad0c38`. Note and notebook
 * ids share this format, so both ignore settings validate their tokens with it.
 */
const ITEM_ID_RE = /^[0-9a-f]{32}$/i;

function normalizeBooleanSetting(value: unknown, defaultValue: boolean): { value: boolean; changed: boolean } {
    if (typeof value === 'boolean') {
        return { value, changed: false };
    }

    return { value: defaultValue, changed: true };
}

export function normalizeBacklinkOpenBehavior(value: unknown): { value: BacklinkOpenBehavior; changed: boolean } {
    if (value === 'newWindow' || value === 'newTab') {
        return { value, changed: false };
    }

    return { value: DEFAULT_BACKLINK_OPEN_BEHAVIOR, changed: true };
}

export function normalizeLinkPreviewMode(
    value: unknown,
    defaultValue: LinkPreviewMode,
    options: { allowHeading?: boolean } = {}
): { value: LinkPreviewMode; changed: boolean } {
    if (isLinkPreviewMode(value, options.allowHeading ?? true)) {
        return { value, changed: false };
    }

    return { value: defaultValue, changed: true };
}

/**
 * Parses a comma-separated list of Joplin item ids, dropping blank, malformed, and duplicate
 * tokens. Shared by the ignored-note and ignored-notebook settings, whose ids have the same format.
 *
 * @returns The accepted ids, lowercased, and whether anything was corrected. A `changed` result is
 *   written back by {@link normalizeStoredSetting} so a malformed value self-heals.
 */
export function normalizeIgnoredIdList(value: unknown): { value: string[]; changed: boolean } {
    if (typeof value !== 'string') {
        return { value: [], changed: true };
    }

    if (!value.trim()) {
        return { value: [], changed: false };
    }

    const seen = new Set<string>();
    const ignoredIds: string[] = [];
    let changed = false;

    for (const rawToken of value.split(',')) {
        const token = rawToken.trim();
        if (!token) {
            changed = true;
            continue;
        }

        if (!ITEM_ID_RE.test(token)) {
            changed = true;
            continue;
        }

        const id = token.toLowerCase();
        if (seen.has(id)) {
            changed = true;
            continue;
        }

        seen.add(id);
        ignoredIds.push(id);
        changed = changed || id !== token;
    }

    return { value: ignoredIds, changed };
}

/** Stored form of an ignored-id setting: the comma-separated string the user sees in preferences. */
function serializeIgnoredIdList(ids: readonly string[]): string {
    return ids.join(', ');
}

export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SECTION_ID, {
        label: 'Backlinks Navigator',
        iconName: 'fas fa-link',
        description: 'Backlinks and outgoing links panel options',
    });

    await joplin.settings.registerSettings({
        [SETTING_PANEL_WIDTH]: {
            value: DEFAULT_PANEL_WIDTH,
            type: SettingItemType.Int,
            public: true,
            section: SECTION_ID,
            label: 'Panel width (px)',
            description: '[Desktop Only] Set the width of the links panel (min: 240px, max: 640px).',
            minimum: MIN_PANEL_WIDTH,
            maximum: MAX_PANEL_WIDTH,
            step: 10,
        },
        [SETTING_PANEL_MAX_HEIGHT]: {
            value: DEFAULT_PANEL_HEIGHT_PERCENTAGE,
            type: SettingItemType.Int,
            public: true,
            section: SECTION_ID,
            label: 'Panel max height (% of editor)',
            description:
                '[Desktop Only] Set the maximum height for the panel relative to the editor viewport (min: 40%, max: 90%).',
            minimum: MIN_PANEL_HEIGHT_PERCENTAGE,
            maximum: MAX_PANEL_HEIGHT_PERCENTAGE,
            step: 5,
        },
        [SETTING_SHOW_INDICATOR]: {
            value: false,
            type: SettingItemType.Bool,
            public: true,
            section: SECTION_ID,
            label: 'Show link indicator',
            description:
                'Show a clickable badge in the top-right of the editor when the current note has backlinks or outgoing links. ' +
                'This checks links each time a note is opened.',
        },
        [SETTING_IGNORED_BACKLINK_NOTE_IDS]: {
            value: '',
            type: SettingItemType.String,
            public: true,
            section: SECTION_ID,
            label: 'Ignored note IDs',
            description:
                'Comma-separated note IDs to exclude from link results and counts. Example: ' +
                'bb12adaa3c704ff3bf09c0d7f7ad0c38, 14270a1ea65546319c1ed3db0e362c37',
        },
        [SETTING_IGNORED_NOTEBOOK_IDS]: {
            value: '',
            type: SettingItemType.String,
            public: true,
            section: SECTION_ID,
            label: 'Ignored notebook IDs',
            description:
                'Comma-separated notebook IDs to exclude from link results and counts, including ' +
                'their sub-notebooks. Right-click a notebook to add or remove it.',
        },
        [SETTING_CTRL_CLICK_BEHAVIOR]: {
            value: DEFAULT_BACKLINK_OPEN_BEHAVIOR,
            type: SettingItemType.String,
            isEnum: true,
            public: true,
            section: SECTION_ID,
            label: 'Ctrl-click link behavior',
            description:
                '[Desktop Only] Choose where Ctrl-click opens a link. Opening in a new tab requires the Note Tabs plugin.',
            options: BACKLINK_OPEN_BEHAVIOR_OPTIONS,
        },
        [SETTING_CTRL_ENTER_BEHAVIOR]: {
            value: DEFAULT_BACKLINK_OPEN_BEHAVIOR,
            type: SettingItemType.String,
            isEnum: true,
            public: true,
            section: SECTION_ID,
            label: 'Ctrl-Enter link behavior',
            description:
                '[Desktop Only] Choose where Ctrl-Enter opens the selected link. Opening in a new tab requires the Note Tabs plugin.',
            options: BACKLINK_OPEN_BEHAVIOR_OPTIONS,
        },
        [SETTING_BACKLINK_PREVIEW_MODE]: {
            value: DEFAULT_LINK_PREVIEW_SETTINGS.in,
            type: SettingItemType.String,
            isEnum: true,
            public: true,
            section: SECTION_ID,
            label: 'Backlink context preview',
            description: 'Choose how much context to show for backlinks in the panel.',
            options: LINK_PREVIEW_MODE_OPTIONS,
        },
        [SETTING_OUTGOING_PREVIEW_MODE]: {
            value: DEFAULT_LINK_PREVIEW_SETTINGS.out,
            type: SettingItemType.String,
            isEnum: true,
            public: true,
            section: SECTION_ID,
            label: 'Outgoing link context preview',
            description:
                'Choose how much context to show for outgoing links in the panel. The snippet previews the opening of the linked note.',
            options: OUTGOING_LINK_PREVIEW_MODE_OPTIONS,
        },
        [SETTING_DEBUG]: {
            value: false,
            type: SettingItemType.Bool,
            public: true,
            section: SECTION_ID,
            label: 'Enable debug logging',
            description: 'Log verbose diagnostic output to the developer console.',
        },
    });
}

/**
 * Persists a corrected setting value so a malformed stored value self-heals
 * after one read. Only called when normalization actually changed the value.
 */
async function persistNormalizedSetting(key: string, value: unknown): Promise<void> {
    try {
        await joplin.settings.setValue(key, value);
    } catch (error) {
        logger.warn(`Failed to persist normalized setting: ${key}`, { error });
    }
}

interface NormalizedSettingOptions<T> {
    /**
     * Converts the normalized value to its stored form, for settings whose stored representation
     * differs from the parsed one (e.g. an id list stored as a comma-separated string). Defaults to
     * storing the value as-is.
     */
    serialize?: (value: T) => unknown;
}

/**
 * Normalizes an already-read setting value, warning about and self-healing a malformed stored
 * value so it is corrected after one read.
 *
 * Split from {@link loadNormalizedSetting} so callers that read several keys in one batched
 * request can still share this handling.
 */
async function normalizeStoredSetting<T>(
    key: string,
    raw: unknown,
    normalize: (value: unknown) => { value: T; changed: boolean },
    label: string,
    options: NormalizedSettingOptions<T> = {}
): Promise<T> {
    const result = normalize(raw);
    if (result.changed) {
        logger.warn(`Invalid ${label} setting: ${String(raw)}. Using ${String(result.value)}.`);
        await persistNormalizedSetting(key, options.serialize ? options.serialize(result.value) : result.value);
    }
    return result.value;
}

/** Reads one setting and normalizes it. See {@link normalizeStoredSetting}. */
async function loadNormalizedSetting<T>(
    key: string,
    normalize: (value: unknown) => { value: T; changed: boolean },
    label: string,
    options: NormalizedSettingOptions<T> = {}
): Promise<T> {
    return normalizeStoredSetting(key, await joplin.settings.value(key), normalize, label, options);
}

async function loadPanelSettings(): Promise<PanelSettings> {
    const values = await joplin.settings.values([
        SETTING_PANEL_WIDTH,
        SETTING_PANEL_MAX_HEIGHT,
        SETTING_BACKLINK_PREVIEW_MODE,
        SETTING_OUTGOING_PREVIEW_MODE,
    ]);

    const [width, heightPercentage, backlinkPreview, outgoingPreview] = await Promise.all([
        normalizeStoredSetting(SETTING_PANEL_WIDTH, values[SETTING_PANEL_WIDTH], normalizePanelWidth, 'panel width'),
        normalizeStoredSetting(
            SETTING_PANEL_MAX_HEIGHT,
            values[SETTING_PANEL_MAX_HEIGHT],
            normalizePanelHeightPercentage,
            'panel max height'
        ),
        normalizeStoredSetting(
            SETTING_BACKLINK_PREVIEW_MODE,
            values[SETTING_BACKLINK_PREVIEW_MODE],
            (value) => normalizeLinkPreviewMode(value, DEFAULT_LINK_PREVIEW_SETTINGS.in),
            'backlink context preview'
        ),
        normalizeStoredSetting(
            SETTING_OUTGOING_PREVIEW_MODE,
            values[SETTING_OUTGOING_PREVIEW_MODE],
            // Outgoing rows preview the linked note's opening, so the nearest-heading mode is not offered.
            (value) => normalizeLinkPreviewMode(value, DEFAULT_LINK_PREVIEW_SETTINGS.out, { allowHeading: false }),
            'outgoing link context preview'
        ),
    ]);

    return {
        dimensions: {
            width,
            maxHeightPercentage: heightPercentage,
        },
        preview: {
            in: backlinkPreview,
            out: outgoingPreview,
        },
    };
}

export async function loadContentScriptSettings(): Promise<ContentScriptSettings> {
    const [panel, showIndicator] = await Promise.all([loadPanelSettings(), loadShowIndicatorSetting()]);
    return { panel, showIndicator };
}

export async function loadShowIndicatorSetting(): Promise<boolean> {
    return loadNormalizedSetting(
        SETTING_SHOW_INDICATOR,
        (value) => normalizeBooleanSetting(value, false),
        'show indicator'
    );
}

export async function loadIgnoredBacklinkNoteIdsSetting(): Promise<Set<string>> {
    const noteIds = await loadNormalizedSetting(
        SETTING_IGNORED_BACKLINK_NOTE_IDS,
        normalizeIgnoredIdList,
        'ignored note IDs',
        // Stored as the comma-separated string the user typed, parsed into a list of ids.
        { serialize: serializeIgnoredIdList }
    );
    return new Set(noteIds);
}

/**
 * Reads the notebooks to exclude from link results.
 *
 * @returns The ids the user configured, without their sub-notebooks. Callers that filter results
 *   must expand them first; see `expandIgnoredFolderIds` in `noteMetadata.ts`.
 */
export async function loadIgnoredNotebookIdsSetting(): Promise<Set<string>> {
    const notebookIds = await loadNormalizedSetting(
        SETTING_IGNORED_NOTEBOOK_IDS,
        normalizeIgnoredIdList,
        'ignored notebook IDs',
        // Stored as the comma-separated string shown in preferences, parsed into a list of ids.
        { serialize: serializeIgnoredIdList }
    );
    return new Set(notebookIds);
}

/**
 * Replaces the ignored notebooks, so the folder context-menu toggle doesn't have to know how the
 * setting is stored. Writing it fires `onChange`, which refreshes the indicator.
 */
export async function setIgnoredNotebookIdsSetting(ids: Iterable<string>): Promise<void> {
    await joplin.settings.setValue(SETTING_IGNORED_NOTEBOOK_IDS, serializeIgnoredIdList([...ids]));
}

export async function loadCtrlClickBehaviorSetting(): Promise<BacklinkOpenBehavior> {
    return loadNormalizedSetting(SETTING_CTRL_CLICK_BEHAVIOR, normalizeBacklinkOpenBehavior, 'Ctrl-click behavior');
}

export async function loadCtrlEnterBehaviorSetting(): Promise<BacklinkOpenBehavior> {
    return loadNormalizedSetting(SETTING_CTRL_ENTER_BEHAVIOR, normalizeBacklinkOpenBehavior, 'Ctrl-Enter behavior');
}

export async function loadDebugSetting(): Promise<boolean> {
    return loadNormalizedSetting(SETTING_DEBUG, (value) => normalizeBooleanSetting(value, false), 'debug');
}

/** Setting key for the debug toggle, exposed so the host can watch for changes. */
export const DEBUG_SETTING_KEY = SETTING_DEBUG;

const EDITOR_AFFECTING_SETTING_KEYS = new Set([
    SETTING_PANEL_WIDTH,
    SETTING_PANEL_MAX_HEIGHT,
    SETTING_SHOW_INDICATOR,
    SETTING_IGNORED_BACKLINK_NOTE_IDS,
    SETTING_IGNORED_NOTEBOOK_IDS,
    SETTING_BACKLINK_PREVIEW_MODE,
    SETTING_OUTGOING_PREVIEW_MODE,
]);

export function isEditorAffectingSettingChanged(keys: readonly string[]): boolean {
    return keys.some((key) => EDITOR_AFFECTING_SETTING_KEYS.has(key));
}
