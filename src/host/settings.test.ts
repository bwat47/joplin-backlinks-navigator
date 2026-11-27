import { beforeEach, describe, expect, it, vi } from 'vitest';

import joplin from 'api';
import {
    isEditorAffectingSettingChanged,
    isIndicatorAffectingSettingChanged,
    loadContentScriptSettings,
    loadIgnoredBacklinkNoteIdsSetting,
    loadIgnoredNotebookIdsSetting,
    loadMiddleClickBehaviorSetting,
    setIgnoredNotebookIdsSetting,
} from './settings';

vi.mock('api', () => ({
    __esModule: true,
    default: {
        settings: {
            value: vi.fn(),
            values: vi.fn(),
            setValue: vi.fn(),
        },
    },
}));

const mockSettings = vi.mocked(joplin.settings);

const KEY_PANEL_WIDTH = 'backlinksNavigator.panelWidth';
const KEY_PANEL_MAX_HEIGHT = 'backlinksNavigator.panelMaxHeightPercentage';
const KEY_SHOW_BACKLINK_HEADING = 'backlinksNavigator.showBacklinkHeading';
const KEY_COLLAPSE_DETAILS = 'backlinksNavigator.collapseDetails';
const KEY_IGNORED_NOTE_IDS = 'backlinksNavigator.ignoredBacklinkNoteIds';
const KEY_IGNORED_NOTEBOOK_IDS = 'backlinksNavigator.ignoredNotebookIds';
const KEY_MIDDLE_CLICK_BEHAVIOR = 'backlinksNavigator.middleClickBehavior';

describe('settings loading', () => {
    beforeEach(() => {
        mockSettings.value.mockReset();
        mockSettings.values.mockReset();
        mockSettings.setValue.mockReset();
        mockSettings.setValue.mockResolvedValue(undefined);
    });

    it('returns stored panel settings as-is when they are valid', async () => {
        mockSettings.values.mockResolvedValue({
            [KEY_PANEL_WIDTH]: 400,
            [KEY_PANEL_MAX_HEIGHT]: 60,
            [KEY_SHOW_BACKLINK_HEADING]: true,
            [KEY_COLLAPSE_DETAILS]: true,
        });
        mockSettings.value.mockResolvedValue(true);

        await expect(loadContentScriptSettings()).resolves.toEqual({
            panel: {
                dimensions: { width: 400, maxHeightPercentage: 60 },
                showBacklinkHeading: true,
                collapseDetails: true,
            },
            showIndicator: true,
        });
        expect(mockSettings.setValue).not.toHaveBeenCalled();
    });

    it('falls back to defaults and self-heals every malformed panel setting', async () => {
        mockSettings.values.mockResolvedValue({
            [KEY_PANEL_WIDTH]: 9999,
            [KEY_PANEL_MAX_HEIGHT]: 'tall',
            [KEY_SHOW_BACKLINK_HEADING]: 'always',
            [KEY_COLLAPSE_DETAILS]: 'yes',
        });
        mockSettings.value.mockResolvedValue(false);

        await expect(loadContentScriptSettings()).resolves.toEqual({
            panel: {
                dimensions: { width: 640, maxHeightPercentage: 75 },
                showBacklinkHeading: false,
                collapseDetails: false,
            },
            showIndicator: false,
        });

        expect(mockSettings.setValue).toHaveBeenCalledWith(KEY_PANEL_WIDTH, 640);
        expect(mockSettings.setValue).toHaveBeenCalledWith(KEY_PANEL_MAX_HEIGHT, 75);
        expect(mockSettings.setValue).toHaveBeenCalledWith(KEY_SHOW_BACKLINK_HEADING, false);
        expect(mockSettings.setValue).toHaveBeenCalledWith(KEY_COLLAPSE_DETAILS, false);
    });

    it('still resolves panel settings when persisting a correction fails', async () => {
        mockSettings.values.mockResolvedValue({
            [KEY_PANEL_WIDTH]: 10,
            [KEY_PANEL_MAX_HEIGHT]: 60,
            [KEY_SHOW_BACKLINK_HEADING]: false,
            [KEY_COLLAPSE_DETAILS]: false,
        });
        mockSettings.value.mockResolvedValue(false);
        mockSettings.setValue.mockRejectedValue(new Error('settings are read-only'));

        const settings = await loadContentScriptSettings();

        expect(settings.panel.dimensions.width).toBe(240);
    });

    it('loads the configured middle-click behavior', async () => {
        mockSettings.value.mockResolvedValue('newTab');

        await expect(loadMiddleClickBehaviorSetting()).resolves.toBe('newTab');
        expect(mockSettings.value).toHaveBeenCalledWith(KEY_MIDDLE_CLICK_BEHAVIOR);
        expect(mockSettings.setValue).not.toHaveBeenCalled();
    });

    it.each(['current', undefined])(
        'falls back to newWindow and self-heals invalid backlink open behavior (%j)',
        async (stored) => {
            mockSettings.value.mockResolvedValue(stored);

            await expect(loadMiddleClickBehaviorSetting()).resolves.toBe('newWindow');
            expect(mockSettings.setValue).toHaveBeenCalledWith(KEY_MIDDLE_CLICK_BEHAVIOR, 'newWindow');
        }
    );

    it('parses ignored note ids into a set, self-healing them back to a comma-separated string', async () => {
        mockSettings.value.mockResolvedValue(
            'BB12ADAA3C704FF3BF09C0D7F7AD0C38, invalid, bb12adaa3c704ff3bf09c0d7f7ad0c38,'
        );

        await expect(loadIgnoredBacklinkNoteIdsSetting()).resolves.toEqual(
            new Set(['bb12adaa3c704ff3bf09c0d7f7ad0c38'])
        );
        // Stored form differs from the parsed value: a string, never the parsed array.
        expect(mockSettings.setValue).toHaveBeenCalledWith(KEY_IGNORED_NOTE_IDS, 'bb12adaa3c704ff3bf09c0d7f7ad0c38');
    });

    it('leaves a valid ignored note id setting untouched', async () => {
        mockSettings.value.mockResolvedValue('bb12adaa3c704ff3bf09c0d7f7ad0c38, 14270a1ea65546319c1ed3db0e362c37');

        await expect(loadIgnoredBacklinkNoteIdsSetting()).resolves.toEqual(
            new Set(['bb12adaa3c704ff3bf09c0d7f7ad0c38', '14270a1ea65546319c1ed3db0e362c37'])
        );
        expect(mockSettings.setValue).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only ignored id setting as valid', async () => {
        mockSettings.value.mockResolvedValue('  ');

        await expect(loadIgnoredBacklinkNoteIdsSetting()).resolves.toEqual(new Set());
        expect(mockSettings.setValue).not.toHaveBeenCalled();
    });

    it('parses ignored notebook ids into a set, self-healing them back to a comma-separated string', async () => {
        mockSettings.value.mockResolvedValue(
            'F0LDER, 8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b, 8D0E3B4A1C2F4D5E6A7B8C9D0E1F2A3B'
        );

        await expect(loadIgnoredNotebookIdsSetting()).resolves.toEqual(new Set(['8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b']));
        expect(mockSettings.setValue).toHaveBeenCalledWith(
            KEY_IGNORED_NOTEBOOK_IDS,
            '8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b'
        );
    });

    it('leaves a valid ignored notebook id setting untouched', async () => {
        mockSettings.value.mockResolvedValue('8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b, 4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d');

        await expect(loadIgnoredNotebookIdsSetting()).resolves.toEqual(
            new Set(['8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b', '4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d'])
        );
        expect(mockSettings.setValue).not.toHaveBeenCalled();
    });

    it('stores ignored notebook ids as a comma-separated string', async () => {
        await setIgnoredNotebookIdsSetting(
            new Set(['8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b', '4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d'])
        );

        expect(mockSettings.setValue).toHaveBeenCalledWith(
            KEY_IGNORED_NOTEBOOK_IDS,
            '8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b, 4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d'
        );
    });

    it('stores an empty string when the last ignored notebook is removed', async () => {
        await setIgnoredNotebookIdsSetting(new Set<string>());

        expect(mockSettings.setValue).toHaveBeenCalledWith(KEY_IGNORED_NOTEBOOK_IDS, '');
    });
});

describe('setting change classification', () => {
    it('treats panel-only settings as editor-affecting without requiring an indicator refresh', () => {
        for (const key of [KEY_PANEL_WIDTH, KEY_PANEL_MAX_HEIGHT, KEY_SHOW_BACKLINK_HEADING]) {
            expect(isEditorAffectingSettingChanged([key])).toBe(true);
            expect(isIndicatorAffectingSettingChanged([key])).toBe(false);
        }
    });

    it('does not push the collapse choice, which the toggling editor already applied', () => {
        expect(isEditorAffectingSettingChanged([KEY_COLLAPSE_DETAILS])).toBe(false);
    });

    it('treats indicator visibility and ignore lists as affecting both editor and indicator', () => {
        for (const key of ['backlinksNavigator.showIndicator', KEY_IGNORED_NOTE_IDS, KEY_IGNORED_NOTEBOOK_IDS]) {
            expect(isEditorAffectingSettingChanged([key])).toBe(true);
            expect(isIndicatorAffectingSettingChanged([key])).toBe(true);
        }
    });

    it('ignores unrelated settings', () => {
        expect(isEditorAffectingSettingChanged(['backlinksNavigator.debug'])).toBe(false);
        expect(isIndicatorAffectingSettingChanged(['backlinksNavigator.debug'])).toBe(false);
    });
});
