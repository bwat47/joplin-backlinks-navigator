import type { LinkItem } from '../types';

/**
 * One visible panel row.
 *
 * - `group`: the header of a note with several rows (backlink occurrences or outgoing
 *   destinations). Selecting it opens the note as a whole. `items` are the links nested under it.
 * - `link`: a single link. `nested` rows sit under their note's group header; a note with only
 *   one link is shown as one unnested `link` row instead of a header with a single child.
 */
export type PanelRow =
    | { kind: 'group'; id: string; noteId: string; items: [LinkItem, ...LinkItem[]] }
    | { kind: 'link'; id: string; noteId: string; link: LinkItem; nested: boolean };

/**
 * Groups rows by linked note, ordering groups by each note's first row. Rows arrive sorted by
 * title then note (see `linkSort.ts`), but grouping doesn't rely on a note's rows being adjacent,
 * so a filter that reorders them still yields one group per note.
 */
function groupLinksByNote(items: readonly LinkItem[]): LinkItem[][] {
    const groups = new Map<string, LinkItem[]>();
    for (const item of items) {
        const group = groups.get(item.noteId);
        if (group) {
            group.push(item);
        } else {
            groups.set(item.noteId, [item]);
        }
    }
    return [...groups.values()];
}

/**
 * Whether a link gets a nested row under its note's header. An outgoing link to the note as a
 * whole doesn't: selecting the header already opens the note without scrolling, so the row would
 * repeat it. The header's count therefore counts only the nested links (e.g. distinct anchors).
 */
function isNestedLink(link: LinkItem): boolean {
    return link.direction === 'in' || link.anchor !== '';
}

/**
 * Builds the panel's visible rows: one entry per linked note, followed by that note's links when
 * it has several and the groups are expanded.
 *
 * @param collapsed - Hide the nested rows, leaving one row per note.
 */
export function buildPanelRows(items: readonly LinkItem[], collapsed: boolean): PanelRow[] {
    const rows: PanelRow[] = [];
    for (const group of groupLinksByNote(items)) {
        const [first] = group;
        if (!first) {
            continue;
        }
        if (group.length === 1) {
            rows.push({ kind: 'link', id: first.id, noteId: first.noteId, link: first, nested: false });
            continue;
        }
        const [firstNested, ...restNested] = group.filter(isNestedLink);
        if (!firstNested) {
            rows.push({ kind: 'link', id: first.id, noteId: first.noteId, link: first, nested: false });
            continue;
        }
        const nested: [LinkItem, ...LinkItem[]] = [firstNested, ...restNested];
        rows.push({ kind: 'group', id: `group:${first.noteId}`, noteId: first.noteId, items: nested });
        if (!collapsed) {
            for (const link of nested) {
                rows.push({ kind: 'link', id: link.id, noteId: link.noteId, link, nested: true });
            }
        }
    }
    return rows;
}

/**
 * Counts distinct linked notes — the number of entries the panel shows at the top level. The tab
 * counts and the indicator badge both use it, so they don't change as the groups expand or collapse.
 */
export function countLinkedNotes(items: readonly LinkItem[]): number {
    return new Set(items.map((item) => item.noteId)).size;
}

/**
 * The link a row opens. A group header stands for its note as a whole, so it opens the note
 * without scrolling to an occurrence (no navigation target) or heading (no anchor).
 */
export function linkForRow(row: PanelRow): LinkItem {
    if (row.kind === 'link') {
        return row.link;
    }
    const { navigationTarget: _navigationTarget, ...rest } = row.items[0];
    return rest.direction === 'out' ? { ...rest, anchor: '' } : rest;
}
