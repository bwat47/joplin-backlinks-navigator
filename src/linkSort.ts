import type { LinkItem } from './types';

/**
 * Orders link rows by note title (case-insensitive), then by note id, then within one note by
 * occurrence index (backlinks) or heading anchor (outgoing links), giving a stable, human-friendly
 * ordering shared by the backlink and outgoing-link services. The anchor tiebreak keeps a note's
 * own row ahead of its heading rows (the empty anchor sorts first) and orders those heading rows
 * deterministically.
 */
export function compareLinkItems(a: LinkItem, b: LinkItem): number {
    const titleCompare = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (titleCompare !== 0) {
        return titleCompare;
    }
    if (a.noteId !== b.noteId) {
        return a.noteId.localeCompare(b.noteId);
    }
    if (a.direction === 'in' && b.direction === 'in') {
        return a.occurrenceIndex - b.occurrenceIndex;
    }
    if (a.direction === 'out' && b.direction === 'out') {
        return a.anchor.localeCompare(b.anchor);
    }
    return 0;
}
