import type { LinkItem } from './types';

/**
 * Orders link rows by note title (case-insensitive), then by note id, then by occurrence index,
 * then by heading anchor, giving a stable, human-friendly ordering shared by the backlink and
 * outgoing-link services. The anchor tiebreak keeps a note's own row ahead of its heading rows
 * (the empty anchor sorts first) and orders those heading rows deterministically.
 */
export function compareLinkItems(a: LinkItem, b: LinkItem): number {
    const titleCompare = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (titleCompare !== 0) {
        return titleCompare;
    }
    if (a.noteId !== b.noteId) {
        return a.noteId.localeCompare(b.noteId);
    }
    const occurrenceCompare = a.occurrenceIndex - b.occurrenceIndex;
    if (occurrenceCompare !== 0) {
        return occurrenceCompare;
    }
    return a.anchor.localeCompare(b.anchor);
}

/**
 * Collapses link rows to one per linked note, keeping the first occurrence of each note in the
 * given order. Used by the title-only backlink mode (panel list, tab count, and badge count),
 * where multiple occurrence rows for the same note carry no distinguishing snippet.
 */
export function dedupeByNoteId(items: readonly LinkItem[]): LinkItem[] {
    const seen = new Set<string>();
    const collapsed: LinkItem[] = [];
    for (const item of items) {
        if (seen.has(item.noteId)) {
            continue;
        }
        seen.add(item.noteId);
        collapsed.push(item);
    }
    return collapsed;
}
