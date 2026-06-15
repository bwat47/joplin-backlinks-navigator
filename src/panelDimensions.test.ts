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
        expect(normalizePanelDimensions({ width: 999, maxHeightRatio: 0.1 })).toEqual({
            width: MAX_PANEL_WIDTH,
            maxHeightRatio: 0.4,
        });
        expect(normalizePanelDimensions({ width: 250, maxHeightRatio: 0.8 })).toEqual({
            width: 250,
            maxHeightRatio: 0.8,
        });
    });

    it('normalizes panel height ratios through panel dimensions', () => {
        expect(normalizePanelDimensions({ maxHeightRatio: 0.95 }).maxHeightRatio).toBe(0.9);
        expect(normalizePanelDimensions({ maxHeightRatio: 0.75 }).maxHeightRatio).toBe(0.75);
    });
});
