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
import type { PanelDimensions } from './types';
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
const SETTING_DEBUG = 'backlinksNavigator.debug';

export interface PanelSettings {
    dimensions: PanelDimensions;
}

function normalizeBooleanSetting(value: unknown, defaultValue: boolean): { value: boolean; changed: boolean } {
    if (typeof value === 'boolean') {
        return { value, changed: false };
    }

    return { value: defaultValue, changed: true };
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

export async function loadDebugSetting(): Promise<boolean> {
    const value = await joplin.settings.value(SETTING_DEBUG);
    return normalizeBooleanSetting(value, false).value;
}

/** Setting key for the debug toggle, exposed so the host can watch for changes. */
export const DEBUG_SETTING_KEY = SETTING_DEBUG;
