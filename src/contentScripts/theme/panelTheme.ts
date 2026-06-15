/**
 * Theme styling for the backlinks navigator panel.
 *
 * Uses Joplin's CSS variables to automatically integrate with the active theme.
 */

import type { PanelDimensions } from '../../types';

const SEARCH_CANCEL_MASK_DATA_URI =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 2l8 8m0-8L2 10' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E";

function formatPanelWidth(width: number): string {
    return `${Math.round(width)}px`;
}

function formatMaxHeight(ratio: number): string {
    const percentage = (ratio * 100).toFixed(2);
    return `${percentage}%`;
}

export function createPanelCss(dimensions: PanelDimensions): string {
    const panelWidth = formatPanelWidth(dimensions.width);
    const maxHeight = formatMaxHeight(dimensions.maxHeightRatio);

    return `
.backlinks-navigator-panel {
    position: absolute;
    top: 12px;
    right: 12px;
    width: ${panelWidth};
    max-height: ${maxHeight};
    display: flex;
    flex-direction: column;
    font-family: system-ui, sans-serif !important;
    background-color: var(--joplin-background-color3, #f4f5f6);
    color: var(--joplin-color, #32373f);
    border: 1px solid var(--joplin-divider-color, #dddddd);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    z-index: 2000;
    overflow: hidden;
}

.backlinks-navigator-input {
    padding: 8px;
    border: none;
    border-bottom: 1px solid var(--joplin-divider-color, #dddddd);
    background-color: inherit;
    color: inherit;
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
    color: var(--joplin-color, #131313);
}

.backlinks-navigator-list {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
    font-size: 13px;
    background-color: inherit;
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
    background-color: transparent;
}

.backlinks-navigator-item:hover {
    background-color: color-mix(in srgb, var(--joplin-selected-color, #e5e5e5) 50%, transparent);
}

.backlinks-navigator-item.is-selected {
    background-color: var(--joplin-selected-color, #e5e5e5);
    color: var(--joplin-color, #131313);
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

.backlinks-navigator-panel.is-mobile .backlinks-navigator-input {
    padding: 12px;
    font-size: 16px; /* Prevents iOS zoom on focus */
}
`;
}
