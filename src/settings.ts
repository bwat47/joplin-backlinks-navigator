/**
 * Joplin settings registration and loading for the backlinks panel.
 *
 * Integrates panel configuration into Joplin's preferences UI.
 *
 * See:
 * - panelDimensions.ts - Validation and normalization utilities
 * - index.ts - Calls registerSettings() on startup and forwards loaded values
 */

import joplin from 'api';
import { SettingItemType } from 'api/types';
import logger from './logger';
import type { BacklinkOpenBehavior, LinkPreviewMode, PanelSettings } from './types';
import { DEFAULT_LINK_PREVIEW_SETTINGS } from './types';
import {
    DEFAULT_PANEL_HEIGHT_PERCENTAGE,
    DEFAULT_PANEL_WIDTH,
    MAX_PANEL_HEIGHT_PERCENTAGE,
    MAX_PANEL_WIDTH,
    MIN_PANEL_HEIGHT_PERCENTAGE,
    MIN_PANEL_WIDTH,
    normalizePanelHeightPercentage,
    normalizePanelWidth,
} from './panelDimensions';

const SECTION_ID = 'backlinksNavigator';
const SETTING_PANEL_WIDTH = 'backlinksNavigator.panelWidth';
const SETTING_PANEL_MAX_HEIGHT = 'backlinksNavigator.panelMaxHeightPercentage';
const SETTING_SHOW_INDICATOR = 'backlinksNavigator.showIndicator';
const SETTING_IGNORED_BACKLINK_NOTE_IDS = 'backlinksNavigator.ignoredBacklinkNoteIds';
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

/**
 * Matches one raw Joplin note id token, e.g. `bb12adaa3c704ff3bf09c0d7f7ad0c38`.
 */
const NOTE_ID_RE = /^[0-9a-f]{32}$/i;

function normalizeBooleanSetting(value: unknown, defaultValue: boolean): { value: boolean; changed: boolean } {
    if (typeof value === 'boolean') {
        return { value, changed: false };
    }

    return { value: defaultValue, changed: true };
}

function normalizeBacklinkOpenBehavior(value: unknown): { value: BacklinkOpenBehavior; changed: boolean } {
    if (value === 'newWindow' || value === 'newTab') {
        return { value, changed: false };
    }

    return { value: DEFAULT_BACKLINK_OPEN_BEHAVIOR, changed: true };
}

export function normalizeCtrlClickBehavior(value: unknown): { value: BacklinkOpenBehavior; changed: boolean } {
    return normalizeBacklinkOpenBehavior(value);
}

export function normalizeCtrlEnterBehavior(value: unknown): { value: BacklinkOpenBehavior; changed: boolean } {
    return normalizeBacklinkOpenBehavior(value);
}

export function normalizeLinkPreviewMode(
    value: unknown,
    defaultValue: LinkPreviewMode
): { value: LinkPreviewMode; changed: boolean } {
    if (value === 'title' || value === 'titleSnippet' || value === 'titleSnippetHeading') {
        return { value, changed: false };
    }

    return { value: defaultValue, changed: true };
}

export function normalizeIgnoredBacklinkNoteIds(value: unknown): { value: string[]; changed: boolean } {
    if (typeof value !== 'string') {
        return { value: [], changed: true };
    }

    if (!value.trim()) {
        return { value: [], changed: false };
    }

    const seen = new Set<string>();
    const ignoredNoteIds: string[] = [];
    let changed = false;

    for (const rawToken of value.split(',')) {
        const token = rawToken.trim();
        if (!token) {
            changed = true;
            continue;
        }

        if (!NOTE_ID_RE.test(token)) {
            changed = true;
            continue;
        }

        const noteId = token.toLowerCase();
        if (seen.has(noteId)) {
            changed = true;
            continue;
        }

        seen.add(noteId);
        ignoredNoteIds.push(noteId);
        changed = changed || noteId !== token;
    }

    return { value: ignoredNoteIds, changed };
}

export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SECTION_ID, {
        label: 'Backlinks Navigator',
        iconName: 'fas fa-link',
        description: 'Backlinks Navigator options',
    });

    await joplin.settings.registerSettings({
        [SETTING_PANEL_WIDTH]: {
            value: DEFAULT_PANEL_WIDTH,
            type: SettingItemType.Int,
            public: true,
            section: SECTION_ID,
            label: 'Panel width (px)',
            description: '[Desktop Only] Set the width of the backlinks panel (min: 240px, max: 640px).',
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
            label: 'Show backlink indicator',
            description:
                'Show a clickable badge in the top-right of the editor when the current note has backlinks. ' +
                'This checks for backlinks each time a note is opened.',
        },
        [SETTING_IGNORED_BACKLINK_NOTE_IDS]: {
            value: '',
            type: SettingItemType.String,
            public: true,
            section: SECTION_ID,
            label: 'Ignored backlink note IDs',
            description:
                'Comma-separated note IDs to exclude from backlink results and counts. Example: ' +
                'bb12adaa3c704ff3bf09c0d7f7ad0c38, 14270a1ea65546319c1ed3db0e362c37',
        },
        [SETTING_CTRL_CLICK_BEHAVIOR]: {
            value: DEFAULT_BACKLINK_OPEN_BEHAVIOR,
            type: SettingItemType.String,
            isEnum: true,
            public: true,
            section: SECTION_ID,
            label: 'Ctrl-click backlink behavior',
            description:
                'Choose where Ctrl-click opens a backlink. Opening in a new tab requires the Note Tabs plugin.',
            options: BACKLINK_OPEN_BEHAVIOR_OPTIONS,
        },
        [SETTING_CTRL_ENTER_BEHAVIOR]: {
            value: DEFAULT_BACKLINK_OPEN_BEHAVIOR,
            type: SettingItemType.String,
            isEnum: true,
            public: true,
            section: SECTION_ID,
            label: 'Ctrl-Enter backlink behavior',
            description:
                'Choose where Ctrl-Enter opens the selected backlink. Opening in a new tab requires the Note Tabs plugin.',
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
            description: 'Choose how much context to show for outgoing links in the panel.',
            options: LINK_PREVIEW_MODE_OPTIONS,
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

export async function loadPanelSettings(): Promise<PanelSettings> {
    const values = await joplin.settings.values([
        SETTING_PANEL_WIDTH,
        SETTING_PANEL_MAX_HEIGHT,
        SETTING_BACKLINK_PREVIEW_MODE,
        SETTING_OUTGOING_PREVIEW_MODE,
    ]);

    const widthResult = normalizePanelWidth(values[SETTING_PANEL_WIDTH]);
    if (widthResult.changed) {
        logger.warn(`Invalid panel width setting: ${values[SETTING_PANEL_WIDTH]}. Using ${widthResult.value}px.`);
        await persistNormalizedSetting(SETTING_PANEL_WIDTH, widthResult.value);
    }

    const heightResult = normalizePanelHeightPercentage(values[SETTING_PANEL_MAX_HEIGHT]);
    if (heightResult.changed) {
        logger.warn(`Invalid panel height setting: ${values[SETTING_PANEL_MAX_HEIGHT]}. Using ${heightResult.value}%.`);
        await persistNormalizedSetting(SETTING_PANEL_MAX_HEIGHT, heightResult.value);
    }

    const backlinkPreviewResult = normalizeLinkPreviewMode(
        values[SETTING_BACKLINK_PREVIEW_MODE],
        DEFAULT_LINK_PREVIEW_SETTINGS.in
    );
    if (backlinkPreviewResult.changed) {
        logger.warn(
            `Invalid backlink context preview setting: ${values[SETTING_BACKLINK_PREVIEW_MODE]}. ` +
                `Using ${backlinkPreviewResult.value}.`
        );
        await persistNormalizedSetting(SETTING_BACKLINK_PREVIEW_MODE, backlinkPreviewResult.value);
    }

    const outgoingPreviewResult = normalizeLinkPreviewMode(
        values[SETTING_OUTGOING_PREVIEW_MODE],
        DEFAULT_LINK_PREVIEW_SETTINGS.out
    );
    if (outgoingPreviewResult.changed) {
        logger.warn(
            `Invalid outgoing link context preview setting: ${values[SETTING_OUTGOING_PREVIEW_MODE]}. ` +
                `Using ${outgoingPreviewResult.value}.`
        );
        await persistNormalizedSetting(SETTING_OUTGOING_PREVIEW_MODE, outgoingPreviewResult.value);
    }

    return {
        dimensions: {
            width: widthResult.value,
            maxHeightRatio: heightResult.value / 100,
        },
        preview: {
            in: backlinkPreviewResult.value,
            out: outgoingPreviewResult.value,
        },
    };
}

export async function loadShowIndicatorSetting(): Promise<boolean> {
    const value = await joplin.settings.value(SETTING_SHOW_INDICATOR);
    const result = normalizeBooleanSetting(value, false);
    if (result.changed) {
        logger.warn(`Invalid show indicator setting: ${value}. Using ${result.value}.`);
        await persistNormalizedSetting(SETTING_SHOW_INDICATOR, result.value);
    }
    return result.value;
}

export async function loadIgnoredBacklinkNoteIdsSetting(): Promise<Set<string>> {
    const value = await joplin.settings.value(SETTING_IGNORED_BACKLINK_NOTE_IDS);
    const result = normalizeIgnoredBacklinkNoteIds(value);
    if (result.changed) {
        logger.warn('Ignored backlink note IDs setting contained invalid, duplicate, or normalized entries.');
        await persistNormalizedSetting(SETTING_IGNORED_BACKLINK_NOTE_IDS, result.value.join(', '));
    }
    return new Set(result.value);
}

export async function loadCtrlClickBehaviorSetting(): Promise<BacklinkOpenBehavior> {
    const value = await joplin.settings.value(SETTING_CTRL_CLICK_BEHAVIOR);
    const result = normalizeCtrlClickBehavior(value);
    if (result.changed) {
        logger.warn(`Invalid Ctrl-click behavior setting: ${value}. Using ${result.value}.`);
        await persistNormalizedSetting(SETTING_CTRL_CLICK_BEHAVIOR, result.value);
    }
    return result.value;
}

export async function loadCtrlEnterBehaviorSetting(): Promise<BacklinkOpenBehavior> {
    const value = await joplin.settings.value(SETTING_CTRL_ENTER_BEHAVIOR);
    const result = normalizeCtrlEnterBehavior(value);
    if (result.changed) {
        logger.warn(`Invalid Ctrl-Enter behavior setting: ${value}. Using ${result.value}.`);
        await persistNormalizedSetting(SETTING_CTRL_ENTER_BEHAVIOR, result.value);
    }
    return result.value;
}

export async function loadDebugSetting(): Promise<boolean> {
    const value = await joplin.settings.value(SETTING_DEBUG);
    const result = normalizeBooleanSetting(value, false);
    if (result.changed) {
        logger.warn(`Invalid debug setting: ${value}. Using ${result.value}.`);
        await persistNormalizedSetting(SETTING_DEBUG, result.value);
    }
    return result.value;
}

/** Setting key for the debug toggle, exposed so the host can watch for changes. */
export const DEBUG_SETTING_KEY = SETTING_DEBUG;
