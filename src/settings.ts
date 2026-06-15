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
import type { BacklinkOpenBehavior, PanelDimensions } from './types';
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
const SETTING_CTRL_CLICK_BEHAVIOR = 'backlinksNavigator.ctrlClickBehavior';
const SETTING_CTRL_ENTER_BEHAVIOR = 'backlinksNavigator.ctrlEnterBehavior';
const SETTING_DEBUG = 'backlinksNavigator.debug';
const DEFAULT_BACKLINK_OPEN_BEHAVIOR: BacklinkOpenBehavior = 'newWindow';
const BACKLINK_OPEN_BEHAVIOR_OPTIONS: Record<BacklinkOpenBehavior, string> = {
    newWindow: 'Open note in new window',
    newTab: 'Open note in Note Tabs tab',
};

export interface PanelSettings {
    dimensions: PanelDimensions;
}

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

export async function loadPanelSettings(): Promise<PanelSettings> {
    const values = await joplin.settings.values([SETTING_PANEL_WIDTH, SETTING_PANEL_MAX_HEIGHT]);

    const widthResult = normalizePanelWidth(values[SETTING_PANEL_WIDTH]);
    if (widthResult.changed) {
        logger.warn(`Invalid panel width setting: ${values[SETTING_PANEL_WIDTH]}. Using ${widthResult.value}px.`);
    }

    const heightResult = normalizePanelHeightPercentage(values[SETTING_PANEL_MAX_HEIGHT]);
    if (heightResult.changed) {
        logger.warn(`Invalid panel height setting: ${values[SETTING_PANEL_MAX_HEIGHT]}. Using ${heightResult.value}%.`);
    }

    return {
        dimensions: {
            width: widthResult.value,
            maxHeightRatio: heightResult.value / 100,
        },
    };
}

export async function loadShowIndicatorSetting(): Promise<boolean> {
    const value = await joplin.settings.value(SETTING_SHOW_INDICATOR);
    return normalizeBooleanSetting(value, false).value;
}

export async function loadCtrlClickBehaviorSetting(): Promise<BacklinkOpenBehavior> {
    const value = await joplin.settings.value(SETTING_CTRL_CLICK_BEHAVIOR);
    const result = normalizeCtrlClickBehavior(value);
    if (result.changed) {
        logger.warn(`Invalid Ctrl-click behavior setting: ${value}. Using ${result.value}.`);
    }
    return result.value;
}

export async function loadCtrlEnterBehaviorSetting(): Promise<BacklinkOpenBehavior> {
    const value = await joplin.settings.value(SETTING_CTRL_ENTER_BEHAVIOR);
    const result = normalizeCtrlEnterBehavior(value);
    if (result.changed) {
        logger.warn(`Invalid Ctrl-Enter behavior setting: ${value}. Using ${result.value}.`);
    }
    return result.value;
}

export async function loadDebugSetting(): Promise<boolean> {
    const value = await joplin.settings.value(SETTING_DEBUG);
    return normalizeBooleanSetting(value, false).value;
}

/** Setting key for the debug toggle, exposed so the host can watch for changes. */
export const DEBUG_SETTING_KEY = SETTING_DEBUG;
