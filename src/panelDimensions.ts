/**
 * Panel dimension validation and normalization utilities.
 *
 * Enforces min/max constraints on panel dimensions to ensure usability:
 * - Width: 240-640px (too narrow = unusable, too wide = blocks editor)
 * - Height: 40-90% of viewport (too short = not enough entries visible, too tall = blocks content)
 *
 * User settings from plugin configuration are untrusted and must be validated
 * before being applied to the UI. Invalid values fall back to defaults. The host applies these
 * when it loads settings (see host/settings.ts); the content script receives the result as is.
 */

import { DEFAULT_PANEL_DIMENSIONS } from './types';

export const MIN_PANEL_WIDTH = 240;
export const MAX_PANEL_WIDTH = 640;
export const MIN_PANEL_HEIGHT_PERCENTAGE = 40;
export const MAX_PANEL_HEIGHT_PERCENTAGE = 90;

export const DEFAULT_PANEL_WIDTH = DEFAULT_PANEL_DIMENSIONS.width;
export const DEFAULT_PANEL_HEIGHT_PERCENTAGE = DEFAULT_PANEL_DIMENSIONS.maxHeightPercentage;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

export function normalizePanelWidth(raw: unknown): { value: number; changed: boolean } {
    const fallback = DEFAULT_PANEL_WIDTH;
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
        return { value: fallback, changed: true };
    }
    const clamped = clamp(Math.round(raw), MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
    return { value: clamped, changed: clamped !== raw };
}

export function normalizePanelHeightPercentage(raw: unknown): { value: number; changed: boolean } {
    const fallback = DEFAULT_PANEL_HEIGHT_PERCENTAGE;
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
        return { value: fallback, changed: true };
    }
    const clamped = clamp(Math.round(raw), MIN_PANEL_HEIGHT_PERCENTAGE, MAX_PANEL_HEIGHT_PERCENTAGE);
    return { value: clamped, changed: clamped !== raw };
}
