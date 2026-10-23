import { describe, it, expect } from 'vitest';
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

describe('panel dimension normalization', () => {
    it('rounds and clamps panel width settings', () => {
        expect(normalizePanelWidth(321.6)).toEqual({ value: 322, changed: true });
        expect(normalizePanelWidth(MIN_PANEL_WIDTH - 1)).toEqual({ value: MIN_PANEL_WIDTH, changed: true });
        expect(normalizePanelWidth(MAX_PANEL_WIDTH + 1)).toEqual({ value: MAX_PANEL_WIDTH, changed: true });
    });

    it('falls back to default width for invalid values', () => {
        expect(normalizePanelWidth('wide')).toEqual({ value: DEFAULT_PANEL_WIDTH, changed: true });
        expect(normalizePanelWidth(Number.NaN)).toEqual({ value: DEFAULT_PANEL_WIDTH, changed: true });
    });

    it('rounds and clamps panel height percentage settings', () => {
        expect(normalizePanelHeightPercentage(66.6)).toEqual({ value: 67, changed: true });
        expect(normalizePanelHeightPercentage(MIN_PANEL_HEIGHT_PERCENTAGE - 1)).toEqual({
            value: MIN_PANEL_HEIGHT_PERCENTAGE,
            changed: true,
        });
        expect(normalizePanelHeightPercentage(MAX_PANEL_HEIGHT_PERCENTAGE + 1)).toEqual({
            value: MAX_PANEL_HEIGHT_PERCENTAGE,
            changed: true,
        });
    });

    it('falls back to default height percentage for invalid values', () => {
        expect(normalizePanelHeightPercentage('tall')).toEqual({
            value: DEFAULT_PANEL_HEIGHT_PERCENTAGE,
            changed: true,
        });
    });

    it('treats the height as a percentage, not a ratio', () => {
        // A ratio-shaped value is out of range for a percentage and clamps up, rather than being
        // silently accepted as "75% of the viewport".
        expect(normalizePanelHeightPercentage(0.75).value).toBe(MIN_PANEL_HEIGHT_PERCENTAGE);
    });
});
