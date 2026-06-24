/**
 * Outgoing-link discovery (plugin host side).
 *
 * Finds every distinct note that the current note links to via Joplin's internal link syntax
 * `[text](:/<noteId>)`. Unlike backlinks, this needs no FTS search: the current note's own body
 * is fetched and its `:/<id>` links are extracted directly.
 *
 * Strategy:
 * 1. Fetch the current note's body.
 * 2. Extract every `:/<id>` occurrence, in document order.
 * 3. Group by target id (one row per distinct linked note), skipping self-links and ignored notes.
 * 4. Resolve each target's title, parent notebook, and body, dropping broken links that can't be
 *    resolved. The snippet previews the opening of the linked note (where the link leads) rather
 *    than the context around the link in the current note.
 *
 * Only the plugin host has Data API access, so this runs here rather than in the content script.
 */

import joplin from 'api';
import logger from './logger';
import type { LinkItem } from './types';
import { extractNoteLinks, extractNoteOpening } from './linkExtraction';
import { resolveNoteMeta, resolveNotebookName, type NoteMeta } from './noteMetadata';
import { compareLinkItems } from './linkSort';

interface FindOutgoingLinksOptions {
    ignoredNoteIds?: ReadonlySet<string>;
}

/**
 * Finds all distinct notes that the given note links to.
 *
 * @param noteId - ID of the note to read outgoing links from.
 * @param options - Optional filters, including note ids to omit from results.
 * @returns One entry per distinct linked note, sorted by title. Returns `[]` on failure.
 */
export async function findOutgoingLinks(noteId: string, options: FindOutgoingLinksOptions = {}): Promise<LinkItem[]> {
    if (!noteId) {
        return [];
    }

    const ignoredNoteIds = options.ignoredNoteIds ?? new Set<string>();

    let body: string;
    try {
        const note = await joplin.data.get(['notes', noteId], { fields: ['id', 'body'] });
        body = typeof note?.body === 'string' ? note.body : '';
    } catch (error) {
        logger.error('Outgoing link lookup failed', { noteId, error });
        return [];
    }

    const occurrences = extractNoteLinks(body);
    if (!occurrences.length) {
        return [];
    }

    // Group occurrences by target id, counting links per distinct note (document order).
    const groups = new Map<string, { count: number }>();
    occurrences.forEach((occurrence) => {
        const targetId = occurrence.targetId;
        if (targetId === noteId.toLowerCase() || ignoredNoteIds.has(targetId)) {
            return;
        }
        const existing = groups.get(targetId);
        if (existing) {
            existing.count += 1;
        } else {
            groups.set(targetId, { count: 1 });
        }
    });

    const noteMetaCache = new Map<string, NoteMeta | null>();
    const notebookCache = new Map<string, string>();
    const outgoing: LinkItem[] = [];

    for (const [targetId, group] of groups) {
        const meta = await resolveNoteMeta(targetId, noteMetaCache, { includeBody: true });
        if (!meta) {
            // Broken link (target note no longer exists) — nothing to navigate to.
            continue;
        }
        const notebookName = await resolveNotebookName(meta.parent_id, notebookCache);
        outgoing.push({
            direction: 'out',
            id: targetId,
            noteId: targetId,
            occurrenceIndex: 0,
            occurrenceCount: group.count,
            title: meta.title,
            notebookName,
            // Outgoing links don't show a nearest-heading; the snippet previews the linked note's opening.
            section: '',
            snippet: extractNoteOpening(meta.body),
        });
    }

    outgoing.sort(compareLinkItems);

    logger.debug('Resolved outgoing links', { noteId, count: outgoing.length });
    return outgoing;
}
