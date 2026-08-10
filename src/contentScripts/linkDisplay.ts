import type { LinkCounts, LinkDirection, LinkItem, LinkPreviewMode, LinkPreviewSettings } from '../types';
import { dedupeByNoteId } from '../linkSort';

/**
 * Whether a direction's rows collapse to one per linked note under the given preview mode.
 *
 * Backlinks in title-only mode do: with no snippet to tell occurrences apart, repeating the same
 * title adds nothing. This predicate is the single source of that rule — the panel list, the tab
 * counts, and the indicator badge all derive from it, so they cannot disagree.
 */
function collapsesToOneRowPerNote(direction: LinkDirection, previewMode: LinkPreviewMode): boolean {
    return direction === 'in' && previewMode === 'title';
}

/**
 * Applies UI display policy to link rows. Backlinks in title-only mode collapse
 * to one row per source note because repeated occurrence rows are indistinguishable.
 */
export function getDisplayLinks(
    items: readonly LinkItem[],
    direction: LinkDirection,
    previewMode: LinkPreviewMode
): LinkItem[] {
    return collapsesToOneRowPerNote(direction, previewMode) ? dedupeByNoteId(items) : [...items];
}

export function getDisplayLinkCount(
    items: readonly LinkItem[],
    direction: LinkDirection,
    previewMode: LinkPreviewMode
): number {
    return collapsesToOneRowPerNote(direction, previewMode) ? dedupeByNoteId(items).length : items.length;
}

/**
 * Derives the badge's backlink tallies from resolved backlink rows, so opening the panel can
 * refresh the indicator without a second round trip to the host.
 */
export function toBacklinkCounts(
    items: readonly LinkItem[]
): Pick<LinkCounts, 'backlinkOccurrences' | 'backlinkNotes'> {
    return {
        backlinkOccurrences: items.length,
        backlinkNotes: dedupeByNoteId(items).length,
    };
}

/**
 * Applies the same display policy as {@link getDisplayLinks} to precomputed {@link LinkCounts},
 * yielding the numbers the indicator badge shows.
 */
export function getDisplayCounts(
    counts: LinkCounts,
    preview: LinkPreviewSettings
): { backlinks: number; outgoing: number } {
    return {
        backlinks: collapsesToOneRowPerNote('in', preview.in) ? counts.backlinkNotes : counts.backlinkOccurrences,
        outgoing: counts.outgoing,
    };
}
