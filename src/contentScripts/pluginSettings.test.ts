import { MAX_PANEL_WIDTH, MIN_PANEL_HEIGHT_PERCENTAGE } from '../panelDimensions';
import { DEFAULT_LINK_PREVIEW_SETTINGS, DEFAULT_PANEL_DIMENSIONS } from '../types';
import { DEFAULT_CONTENT_SCRIPT_SETTINGS, normalizeContentScriptSettings } from './pluginSettings';

describe('content script settings normalization', () => {
    it('falls back to defaults for malformed settings', () => {
        expect(normalizeContentScriptSettings('bad')).toEqual(DEFAULT_CONTENT_SCRIPT_SETTINGS);
        expect(normalizeContentScriptSettings(null)).toEqual(DEFAULT_CONTENT_SCRIPT_SETTINGS);
    });

    it('normalizes valid panel dimensions', () => {
        expect(
            normalizeContentScriptSettings({
                panel: {
                    dimensions: { width: 999, maxHeightRatio: 0.1 },
                    preview: DEFAULT_LINK_PREVIEW_SETTINGS,
                },
                showIndicator: true,
            })
        ).toEqual({
            panel: {
                dimensions: {
                    width: MAX_PANEL_WIDTH,
                    maxHeightRatio: MIN_PANEL_HEIGHT_PERCENTAGE / 100,
                },
                preview: DEFAULT_LINK_PREVIEW_SETTINGS,
            },
            showIndicator: true,
        });
    });

    it('rejects nearest-heading preview for outgoing links', () => {
        const settings = normalizeContentScriptSettings({
            panel: {
                dimensions: DEFAULT_PANEL_DIMENSIONS,
                preview: { in: 'titleSnippetHeading', out: 'titleSnippetHeading' },
            },
            showIndicator: true,
        });

        expect(settings.panel.preview).toEqual({
            in: 'titleSnippetHeading',
            out: DEFAULT_LINK_PREVIEW_SETTINGS.out,
        });
    });

    it('accepts only booleans for showIndicator', () => {
        expect(normalizeContentScriptSettings({ showIndicator: true }).showIndicator).toBe(true);
        expect(normalizeContentScriptSettings({ showIndicator: false }).showIndicator).toBe(false);
        expect(normalizeContentScriptSettings({ showIndicator: 'true' }).showIndicator).toBe(false);
    });
});
