import type { LinkDirection, LinkItem, LinkPreviewMode } from './types';
import { dedupeByNoteId } from './linkSort';

/**
 * Applies UI display policy to link rows. Backlinks in title-only mode collapse
 * to one row per source note because repeated occurrence rows are indistinguishable.
 */
export function getDisplayLinks(
    items: readonly LinkItem[],
    direction: LinkDirection,
    previewMode: LinkPreviewMode
): LinkItem[] {
    if (direction === 'in' && previewMode === 'title') {
        return dedupeByNoteId(items);
    }
    return [...items];
}

export function getDisplayLinkCount(
    items: readonly LinkItem[],
    direction: LinkDirection,
    previewMode: LinkPreviewMode
): number {
    return getDisplayLinks(items, direction, previewMode).length;
}
