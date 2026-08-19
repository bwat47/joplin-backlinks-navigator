import { vi, type Mock } from 'vitest';

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

import joplin from 'api';
import {
    loadContentScriptSettings,
    loadIgnoredBacklinkNoteIdsSetting,
    loadIgnoredNotebookIdsSetting,
    normalizeBacklinkOpenBehavior,
    normalizeIgnoredIdList,
    normalizeLinkPreviewMode,
    setIgnoredNotebookIdsSetting,
} from './settings';

const mockValue = joplin.settings.value as Mock;
const mockValues = joplin.settings.values as Mock;
const mockSetValue = joplin.settings.setValue as Mock;

const KEY_PANEL_WIDTH = 'backlinksNavigator.panelWidth';
const KEY_PANEL_MAX_HEIGHT = 'backlinksNavigator.panelMaxHeightPercentage';
const KEY_BACKLINK_PREVIEW = 'backlinksNavigator.backlinkPreviewMode';
const KEY_OUTGOING_PREVIEW = 'backlinksNavigator.outgoingPreviewMode';
const KEY_IGNORED_NOTE_IDS = 'backlinksNavigator.ignoredBacklinkNoteIds';
const KEY_IGNORED_NOTEBOOK_IDS = 'backlinksNavigator.ignoredNotebookIds';

describe('settings normalization', () => {
    it('accepts supported backlink open behaviors', () => {
        expect(normalizeBacklinkOpenBehavior('newWindow')).toEqual({ value: 'newWindow', changed: false });
        expect(normalizeBacklinkOpenBehavior('newTab')).toEqual({ value: 'newTab', changed: false });
    });

    it('falls back to new window for invalid backlink open behaviors', () => {
        expect(normalizeBacklinkOpenBehavior('current')).toEqual({ value: 'newWindow', changed: true });
        expect(normalizeBacklinkOpenBehavior(undefined)).toEqual({ value: 'newWindow', changed: true });
    });

    it('accepts supported link preview modes', () => {
        expect(normalizeLinkPreviewMode('title', 'titleSnippet')).toEqual({ value: 'title', changed: false });
        expect(normalizeLinkPreviewMode('titleSnippet', 'title')).toEqual({
            value: 'titleSnippet',
            changed: false,
        });
        expect(normalizeLinkPreviewMode('titleSnippetHeading', 'title')).toEqual({
            value: 'titleSnippetHeading',
            changed: false,
        });
    });

    it('rejects the nearest-heading mode when headings are disallowed (outgoing links)', () => {
        expect(normalizeLinkPreviewMode('titleSnippetHeading', 'title', { allowHeading: false })).toEqual({
            value: 'title',
            changed: true,
        });
        expect(normalizeLinkPreviewMode('titleSnippet', 'title', { allowHeading: false })).toEqual({
            value: 'titleSnippet',
            changed: false,
        });
    });

    it('falls back to the provided default for invalid link preview modes', () => {
        expect(normalizeLinkPreviewMode('snippet', 'titleSnippet')).toEqual({
            value: 'titleSnippet',
            changed: true,
        });
        expect(normalizeLinkPreviewMode(undefined, 'title')).toEqual({ value: 'title', changed: true });
    });

    it('parses comma-separated ignored ids', () => {
        expect(normalizeIgnoredIdList('bb12adaa3c704ff3bf09c0d7f7ad0c38, 14270a1ea65546319c1ed3db0e362c37')).toEqual({
            value: ['bb12adaa3c704ff3bf09c0d7f7ad0c38', '14270a1ea65546319c1ed3db0e362c37'],
            changed: false,
        });
    });

    it('drops invalid and duplicate ignored ids', () => {
        expect(
            normalizeIgnoredIdList('BB12ADAA3C704FF3BF09C0D7F7AD0C38, invalid, bb12adaa3c704ff3bf09c0d7f7ad0c38,')
        ).toEqual({
            value: ['bb12adaa3c704ff3bf09c0d7f7ad0c38'],
            changed: true,
        });
    });

    it('treats an empty ignored id setting as valid', () => {
        expect(normalizeIgnoredIdList('  ')).toEqual({ value: [], changed: false });
    });
});

describe('settings loading', () => {
    beforeEach(() => {
        mockValue.mockReset();
        mockValues.mockReset();
        mockSetValue.mockReset();
        mockSetValue.mockResolvedValue(undefined);
    });

    it('returns stored panel settings as-is when they are valid', async () => {
        mockValues.mockResolvedValue({
            [KEY_PANEL_WIDTH]: 400,
            [KEY_PANEL_MAX_HEIGHT]: 60,
            [KEY_BACKLINK_PREVIEW]: 'titleSnippetHeading',
            [KEY_OUTGOING_PREVIEW]: 'title',
        });
        mockValue.mockResolvedValue(true);

        await expect(loadContentScriptSettings()).resolves.toEqual({
            panel: {
                dimensions: { width: 400, maxHeightPercentage: 60 },
                preview: { in: 'titleSnippetHeading', out: 'title' },
            },
            showIndicator: true,
        });
        expect(mockSetValue).not.toHaveBeenCalled();
    });

    it('falls back to defaults and self-heals every malformed panel setting', async () => {
        mockValues.mockResolvedValue({
            [KEY_PANEL_WIDTH]: 9999,
            [KEY_PANEL_MAX_HEIGHT]: 'tall',
            [KEY_BACKLINK_PREVIEW]: 'nope',
            // Valid for backlinks, but the nearest-heading mode is not offered for outgoing links.
            [KEY_OUTGOING_PREVIEW]: 'titleSnippetHeading',
        });
        mockValue.mockResolvedValue(false);

        await expect(loadContentScriptSettings()).resolves.toEqual({
            panel: {
                dimensions: { width: 640, maxHeightPercentage: 75 },
                preview: { in: 'titleSnippet', out: 'titleSnippet' },
            },
            showIndicator: false,
        });

        expect(mockSetValue).toHaveBeenCalledWith(KEY_PANEL_WIDTH, 640);
        expect(mockSetValue).toHaveBeenCalledWith(KEY_PANEL_MAX_HEIGHT, 75);
        expect(mockSetValue).toHaveBeenCalledWith(KEY_BACKLINK_PREVIEW, 'titleSnippet');
        expect(mockSetValue).toHaveBeenCalledWith(KEY_OUTGOING_PREVIEW, 'titleSnippet');
    });

    it('still resolves panel settings when persisting a correction fails', async () => {
        mockValues.mockResolvedValue({
            [KEY_PANEL_WIDTH]: 10,
            [KEY_PANEL_MAX_HEIGHT]: 60,
            [KEY_BACKLINK_PREVIEW]: 'titleSnippet',
            [KEY_OUTGOING_PREVIEW]: 'titleSnippet',
        });
        mockValue.mockResolvedValue(false);
        mockSetValue.mockRejectedValue(new Error('settings are read-only'));

        const settings = await loadContentScriptSettings();

        expect(settings.panel.dimensions.width).toBe(240);
    });

    it('parses ignored note ids into a set, self-healing them back to a comma-separated string', async () => {
        mockValue.mockResolvedValue('BB12ADAA3C704FF3BF09C0D7F7AD0C38, invalid, bb12adaa3c704ff3bf09c0d7f7ad0c38');

        await expect(loadIgnoredBacklinkNoteIdsSetting()).resolves.toEqual(
            new Set(['bb12adaa3c704ff3bf09c0d7f7ad0c38'])
        );
        // Stored form differs from the parsed value: a string, never the parsed array.
        expect(mockSetValue).toHaveBeenCalledWith(KEY_IGNORED_NOTE_IDS, 'bb12adaa3c704ff3bf09c0d7f7ad0c38');
    });

    it('leaves a valid ignored note id setting untouched', async () => {
        mockValue.mockResolvedValue('bb12adaa3c704ff3bf09c0d7f7ad0c38, 14270a1ea65546319c1ed3db0e362c37');

        await expect(loadIgnoredBacklinkNoteIdsSetting()).resolves.toEqual(
            new Set(['bb12adaa3c704ff3bf09c0d7f7ad0c38', '14270a1ea65546319c1ed3db0e362c37'])
        );
        expect(mockSetValue).not.toHaveBeenCalled();
    });

    it('parses ignored notebook ids into a set, self-healing them back to a comma-separated string', async () => {
        mockValue.mockResolvedValue('F0LDER, 8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b, 8D0E3B4A1C2F4D5E6A7B8C9D0E1F2A3B');

        await expect(loadIgnoredNotebookIdsSetting()).resolves.toEqual(new Set(['8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b']));
        expect(mockSetValue).toHaveBeenCalledWith(KEY_IGNORED_NOTEBOOK_IDS, '8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b');
    });

    it('leaves a valid ignored notebook id setting untouched', async () => {
        mockValue.mockResolvedValue('8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b, 4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d');

        await expect(loadIgnoredNotebookIdsSetting()).resolves.toEqual(
            new Set(['8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b', '4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d'])
        );
        expect(mockSetValue).not.toHaveBeenCalled();
    });

    it('stores ignored notebook ids as a comma-separated string', async () => {
        await setIgnoredNotebookIdsSetting(
            new Set(['8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b', '4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d'])
        );

        expect(mockSetValue).toHaveBeenCalledWith(
            KEY_IGNORED_NOTEBOOK_IDS,
            '8d0e3b4a1c2f4d5e6a7b8c9d0e1f2a3b, 4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d'
        );
    });

    it('stores an empty string when the last ignored notebook is removed', async () => {
        await setIgnoredNotebookIdsSetting(new Set<string>());

        expect(mockSetValue).toHaveBeenCalledWith(KEY_IGNORED_NOTEBOOK_IDS, '');
    });
});
