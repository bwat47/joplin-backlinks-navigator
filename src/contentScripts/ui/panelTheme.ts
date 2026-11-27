/**
 * Theme styling for the backlinks navigator panel.
 *
 * Uses Joplin's CSS variables to automatically integrate with the active theme.
 */

import type { PanelDimensions } from '../../types';

/**
 * Inline CSS custom property carrying the editor's resolved font family.
 *
 * Joplin desktop applies the "Editor font family" setting only to `.cm-editor .cm-content` via a
 * global stylesheet (there is no CSS variable for it), and the overlays live outside that element, so `ui/editorOverlay.ts` copies the computed font onto
 * them. `--joplin-font-family` is the fallback when the editor font cannot be read.
 */
export const OVERLAY_FONT_FAMILY_VAR = '--backlinks-navigator-font-family';

/**
 * Inline CSS custom property carrying the editor's resolved font size, copied alongside
 * {@link OVERLAY_FONT_FAMILY_VAR} for the same reason. Only the indicator badge scales with it.
 */
export const OVERLAY_FONT_SIZE_VAR = '--backlinks-navigator-font-size';

/** Font stack shared by the panel and the indicator badge: the editor font, then Joplin's UI font. */
const OVERLAY_FONT_FAMILY_CSS = `font-family: var(${OVERLAY_FONT_FAMILY_VAR}, var(--joplin-font-family, system-ui, sans-serif)) !important;`;

/**
 * Badge text size: a fixed fraction of the editor font size, so the badge stays in proportion as
 * the editor font grows or shrinks. The fallback editor size (15px, Joplin's default) keeps the
 * badge at 12px when the editor size cannot be read; the clamp stops it getting unreadably small
 * or oversized at extreme settings. Badge spacing and icons are in `em`, so they follow this.
 */
const INDICATOR_FONT_SIZE_CSS = `font-size: clamp(11px, calc(var(${OVERLAY_FONT_SIZE_VAR}, 15px) * 0.8), 18px);`;

const SEARCH_CANCEL_MASK_DATA_URI =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 2l8 8m0-8L2 10' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E";

/**
 * Positioning shared by both overlays: each floats in the top-right of the editor's scroll area.
 * `right` is only a starting value — `ui/editorOverlay.ts` overrides it inline to clear the
 * editor's scrollbar. Stacking order is deliberately not shared: the panel sits above the badge.
 */
const OVERLAY_ANCHOR_CSS = `position: absolute;
    top: 12px;
    right: 12px;`;

function formatPanelWidth(width: number): string {
    return `${Math.round(width)}px`;
}

function formatMaxHeight(percentage: number): string {
    return `${Math.round(percentage)}%`;
}

export function createPanelCss(dimensions: PanelDimensions): string {
    const panelWidth = formatPanelWidth(dimensions.width);
    const maxHeight = formatMaxHeight(dimensions.maxHeightPercentage);

    return `
.backlinks-navigator-panel {
    ${OVERLAY_ANCHOR_CSS}
    width: ${panelWidth};
    max-height: ${maxHeight};
    display: flex;
    flex-direction: column;
    ${OVERLAY_FONT_FAMILY_CSS}
    background-color: var(--joplin-background-color3, #f4f5f6);
    color: var(--joplin-color, #32373f);
    border: 1px solid var(--joplin-divider-color, #dddddd);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    z-index: 2000;
    overflow: hidden;
}

.backlinks-navigator-tabs {
    display: flex;
    flex: 0 0 auto;
    border-bottom: 1px solid var(--joplin-divider-color, #dddddd);
}

.backlinks-navigator-tab {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background-color: transparent;
    color: var(--joplin-color-faded, #7c8b9e);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    outline: none;
}

.backlinks-navigator-tab:hover {
    background-color: color-mix(in srgb, var(--joplin-selected-color, #e5e5e5) 40%, transparent);
}

.backlinks-navigator-tab.is-active {
    color: var(--joplin-color, #32373f);
    border-bottom-color: var(--joplin-color4, #2b6cb0);
}

.backlinks-navigator-tab-count {
    font-size: 11px;
    font-weight: 700;
    opacity: 0.85;
}

/* Toggles compact vs. detailed panel rows; sits at the end of the tab bar. */
.backlinks-navigator-collapse-toggle {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background-color: transparent;
    color: var(--joplin-color-faded, #7c8b9e);
    cursor: pointer;
    outline: none;
}

.backlinks-navigator-collapse-toggle:hover {
    color: var(--joplin-color, #32373f);
    background-color: color-mix(in srgb, var(--joplin-selected-color, #e5e5e5) 40%, transparent);
}

.backlinks-navigator-collapse-toggle svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.backlinks-navigator-input {
    padding: 8px;
    border: none;
    border-bottom: 1px solid var(--joplin-divider-color, #dddddd);
    background-color: inherit;
    color: inherit;
    font-family: inherit;
    font-size: 14px;
    outline: none;
}

.backlinks-navigator-input::placeholder {
    color: var(--joplin-color-faded, #7c8b9e);
}

.backlinks-navigator-input::-webkit-search-cancel-button {
    appearance: none;
    -webkit-appearance: none;
    height: 16px;
    width: 16px;
    border-radius: 50%;
    color: var(--joplin-color, #32373f);
    cursor: pointer;
    opacity: 0.75;
    transition: opacity 120ms ease-out;
    /* Render X icon via mask so it inherits currentColor */
    background-color: currentColor;
    -webkit-mask-image: url("${SEARCH_CANCEL_MASK_DATA_URI}");
    mask-image: url("${SEARCH_CANCEL_MASK_DATA_URI}");
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: 14px 14px;
    mask-size: 14px 14px;
}

.backlinks-navigator-input::-webkit-search-cancel-button:hover {
    opacity: 1;
}

.backlinks-navigator-list {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
    font-size: 13px;
}

.backlinks-navigator-list::-webkit-scrollbar {
    width: 8px;
}

/* Hide the scrollbar up/down arrow buttons (Chromium renders these by default) */
.backlinks-navigator-list::-webkit-scrollbar-button {
    display: none;
}

.backlinks-navigator-list::-webkit-scrollbar-thumb {
    background-color: var(--joplin-scrollbar-thumb-color, rgba(50, 55, 63, 0.54));
    border-radius: 4px;
}

.backlinks-navigator-list::-webkit-scrollbar-thumb:hover {
    background-color: var(--joplin-scrollbar-thumb-color-hover, rgba(50, 55, 63, 0.63));
}

.backlinks-navigator-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    cursor: pointer;
}

.backlinks-navigator-item:hover {
    background-color: color-mix(in srgb, var(--joplin-selected-color, #e5e5e5) 50%, transparent);
}

.backlinks-navigator-item.is-selected {
    background-color: var(--joplin-selected-color, #e5e5e5);
}

.backlinks-navigator-item-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
}

.backlinks-navigator-item-title {
    flex: 1 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
}

.backlinks-navigator-item-title b {
    font-weight: 700;
    color: var(--joplin-color-bright, inherit);
}

/* An outgoing link whose target note is in the trash. */
.backlinks-navigator-item.is-trashed .backlinks-navigator-item-title {
    text-decoration: line-through;
    opacity: 0.7;
}

.backlinks-navigator-item.is-trashed .backlinks-navigator-item-notebook {
    font-style: italic;
}

.backlinks-navigator-item-notebook {
    flex: 0 0 auto;
    max-width: 40%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    color: var(--joplin-color-faded, #7c8b9e);
}

.backlinks-navigator-item.is-selected .backlinks-navigator-item-notebook {
    color: inherit;
    opacity: 0.85;
}

/* How many links a grouped note holds. */
.backlinks-navigator-item-count {
    flex: 0 0 auto;
    align-self: center;
    min-width: 18px;
    padding: 0 6px;
    border-radius: 999px;
    box-sizing: border-box;
    background-color: color-mix(in srgb, var(--joplin-color-faded, #7c8b9e) 22%, transparent);
    font-size: 11px;
    font-weight: 600;
    line-height: 17px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

/* A link nested under its note's group header, with a guide line tying it to the header. */
.backlinks-navigator-item.is-nested {
    position: relative;
    padding: 5px 12px 5px 26px;
}

.backlinks-navigator-item.is-nested::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 14px;
    border-left: 1px solid var(--joplin-divider-color, #dddddd);
}

.backlinks-navigator-item-section {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    color: var(--joplin-color-faded, #7c8b9e);
    opacity: 0.9;
}

.backlinks-navigator-item.is-selected .backlinks-navigator-item-section {
    color: inherit;
    opacity: 0.85;
}

.backlinks-navigator-item-snippet {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--joplin-color-faded, #7c8b9e);
}

.backlinks-navigator-item.is-selected .backlinks-navigator-item-snippet {
    color: inherit;
    opacity: 0.85;
}

.backlinks-navigator-message {
    padding: 12px;
    color: var(--joplin-color-faded, #7c8b9e);
    text-align: center;
}

/* Mobile Mode Overrides */
.backlinks-navigator-panel.is-mobile {
    position: fixed;
    top: 50%;
    left: 50%;
    right: auto;
    width: 90vw;
    max-height: 80vh;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45); /* Backdrop dimming */
}

/* Prevent scroll chaining to editor behind panel */
.backlinks-navigator-panel.is-mobile .backlinks-navigator-list {
    overscroll-behavior: contain;
}

/* Larger touch targets on mobile */
.backlinks-navigator-panel.is-mobile .backlinks-navigator-item {
    padding: 14px 16px;
    gap: 4px;
}

.backlinks-navigator-panel.is-mobile .backlinks-navigator-item.is-nested {
    padding: 10px 16px 10px 32px;
}

.backlinks-navigator-panel.is-mobile .backlinks-navigator-item.is-nested::before {
    left: 18px;
}

.backlinks-navigator-panel.is-mobile .backlinks-navigator-collapse-toggle {
    padding: 0 14px;
}

.backlinks-navigator-panel.is-mobile .backlinks-navigator-input {
    padding: 12px;
    font-size: 16px; /* Prevents iOS zoom on focus */
}

.backlinks-navigator-panel.is-mobile .backlinks-navigator-tab {
    padding: 12px 10px;
    font-size: 15px;
}
`;
}

/**
 * Styles for the top-right backlink indicator badge.
 *
 * Kept separate from {@link createPanelCss} (which is dimension-dependent and injected only
 * when the panel opens) so the indicator can style itself the moment it mounts — including
 * before the panel has ever been opened.
 */
export function createIndicatorCss(): string {
    return `
.backlinks-navigator-indicator {
    ${OVERLAY_ANCHOR_CSS}
    display: inline-flex;
    align-items: center;
    gap: 0.42em;
    padding: 0.33em 0.75em;
    border: 1px solid var(--joplin-divider-color, #dddddd);
    border-radius: 999px;
    background-color: var(--joplin-background-color3, #f4f5f6);
    color: var(--joplin-color, #32373f);
    ${OVERLAY_FONT_FAMILY_CSS}
    ${INDICATOR_FONT_SIZE_CSS}
    line-height: 1;
    cursor: pointer;
    /* Light at rest so the always-visible badge sits quietly over the text; lifts on hover/focus. */
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    transition: box-shadow 120ms ease-out, background-color 120ms ease-out;
    z-index: 1999;
}

.backlinks-navigator-indicator:hover,
.backlinks-navigator-indicator:focus-visible {
    background-color: var(--joplin-background-color-hover3, #cbdaf1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    outline: none;
}

/* Keyboard focus ring, layered over the lifted drop shadow. */
.backlinks-navigator-indicator:focus-visible {
    box-shadow:
        0 0 0 2px var(--joplin-color4, #2b6cb0),
        0 2px 8px rgba(0, 0, 0, 0.18);
}

.backlinks-navigator-indicator-direction {
    display: inline-flex;
    align-items: center;
    gap: 0.33em;
}

/* When both directions show, a divider keeps each arrow visibly attached to its own count. */
.backlinks-navigator-indicator.is-split .backlinks-navigator-indicator-direction.is-outgoing {
    margin-left: 0.17em;
    padding-left: 0.58em;
    border-left: 1px solid var(--joplin-divider-color, #dddddd);
}

.backlinks-navigator-indicator-icon {
    display: inline-flex;
    color: var(--joplin-color-faded, #7c8b9e);
}

.backlinks-navigator-indicator-icon svg {
    width: 1.1em;
    height: 1.1em;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.backlinks-navigator-indicator-count {
    font-weight: 600;
    /* Equal-width digits so the badge doesn't shift width as counts change between notes. */
    font-variant-numeric: tabular-nums;
}
`;
}
