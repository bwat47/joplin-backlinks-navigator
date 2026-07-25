import {
    DEFAULT_PANEL_HEIGHT_PERCENTAGE,
    DEFAULT_PANEL_WIDTH,
    MAX_PANEL_HEIGHT_PERCENTAGE,
    MAX_PANEL_WIDTH,
    MIN_PANEL_HEIGHT_PERCENTAGE,
    MIN_PANEL_WIDTH,
    normalizePanelDimensions,
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

    it('normalizes panel dimensions from partial or invalid input', () => {
        expect(normalizePanelDimensions({ width: 999, maxHeightPercentage: 10 })).toEqual({
            width: MAX_PANEL_WIDTH,
            maxHeightPercentage: MIN_PANEL_HEIGHT_PERCENTAGE,
        });
        expect(normalizePanelDimensions({ width: 250, maxHeightPercentage: 80 })).toEqual({
            width: 250,
            maxHeightPercentage: 80,
        });
    });

    it('falls back to defaults for missing panel dimensions', () => {
        expect(normalizePanelDimensions()).toEqual({
            width: DEFAULT_PANEL_WIDTH,
            maxHeightPercentage: DEFAULT_PANEL_HEIGHT_PERCENTAGE,
        });
    });

    it('clamps panel height percentages through panel dimensions', () => {
        expect(normalizePanelDimensions({ maxHeightPercentage: 95 }).maxHeightPercentage).toBe(
            MAX_PANEL_HEIGHT_PERCENTAGE
        );
        expect(normalizePanelDimensions({ maxHeightPercentage: 75 }).maxHeightPercentage).toBe(75);
    });

    it('treats the height as a percentage, not a ratio, on both sides of the boundary', () => {
        // A ratio-shaped value is out of range for a percentage and clamps up, rather than being
        // silently accepted as "75% of the viewport".
        expect(normalizePanelDimensions({ maxHeightPercentage: 0.75 }).maxHeightPercentage).toBe(
            MIN_PANEL_HEIGHT_PERCENTAGE
        );
    });
});
