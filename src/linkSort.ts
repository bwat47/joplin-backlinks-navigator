import type { LinkItem } from './types';

/**
 * Orders link rows by note title (case-insensitive), then by note id, then by occurrence index,
 * giving a stable, human-friendly ordering shared by the backlink and outgoing-link services.
 */
export function compareLinkItems(a: LinkItem, b: LinkItem): number {
    const titleCompare = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (titleCompare !== 0) {
        return titleCompare;
    }
    if (a.noteId !== b.noteId) {
        return a.noteId.localeCompare(b.noteId);
    }
    return a.occurrenceIndex - b.occurrenceIndex;
}
