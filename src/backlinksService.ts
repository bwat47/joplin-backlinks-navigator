/**
 * Backlink discovery (plugin host side).
 *
 * Finds every note whose body links to a given note via Joplin's internal
 * link syntax `[text](:/<noteId>)` (optionally with an anchor `#...`).
 *
 * Strategy:
 * 1. Search the Data API for the note id token. A note id is a 32-char hex
 *    string, indexed by FTS as a single token, so this returns candidate notes.
 * 2. Verify each candidate's body actually contains `:/<noteId>` to drop loose
 *    FTS matches, and capture each matching occurrence as a backlink row.
 * 3. Resolve each candidate's parent notebook title (cached per call).
 *
 * Only the plugin host has Data API access, so this runs here rather than in
 * the content script.
 */

import joplin from 'api';
import logger from './logger';
import type { LinkItem } from './types';
import { extractOccurrenceContexts, findOccurrenceOffsets, linkNeedle } from './linkExtraction';
import { resolveNotebookName } from './noteMetadata';
import { compareLinkItems } from './linkSort';

const SEARCH_PAGE_LIMIT = 100;

interface SearchNote {
    id: string;
    title: string;
    body: string;
    parent_id: string;
}

interface SearchResponse {
    items: SearchNote[];
    has_more: boolean;
}

interface FindBacklinksOptions {
    ignoredNoteIds?: ReadonlySet<string>;
}

/**
 * Finds all notes that link to the given note.
 *
 * @param noteId - ID of the note to find backlinks for.
 * @param options - Optional search filters, including note ids to omit from results.
 * @returns Backlink entries sorted by note title. Returns `[]` on failure.
 */
export async function findBacklinks(noteId: string, options: FindBacklinksOptions = {}): Promise<LinkItem[]> {
    if (!noteId) {
        return [];
    }

    const needle = linkNeedle(noteId);
    const ignoredNoteIds = options.ignoredNoteIds ?? new Set<string>();
    const candidates: SearchNote[] = [];

    try {
        // Paginate through the full search result set.
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const response: SearchResponse = await joplin.data.get(['search'], {
                query: noteId,
                fields: ['id', 'title', 'body', 'parent_id'],
                limit: SEARCH_PAGE_LIMIT,
                page,
            });

            if (response?.items?.length) {
                candidates.push(...response.items);
            }

            hasMore = Boolean(response?.has_more);
            page += 1;
        }
    } catch (error) {
        logger.error('Backlink search failed', { noteId, error });
        return [];
    }

    const notebookCache = new Map<string, string>();
    const backlinks: LinkItem[] = [];

    for (const candidate of candidates) {
        // Drop the note itself and any candidate that doesn't actually contain the link.
        if (candidate.id === noteId || ignoredNoteIds.has(candidate.id.toLowerCase())) {
            continue;
        }
        if (typeof candidate.body !== 'string' || !candidate.body.includes(needle)) {
            continue;
        }

        const offsets = findOccurrenceOffsets(candidate.body, needle);
        const contexts = extractOccurrenceContexts(candidate.body, offsets);
        if (!contexts.length) {
            continue;
        }

        const notebookName = await resolveNotebookName(candidate.parent_id, notebookCache);
        const title = typeof candidate.title === 'string' && candidate.title ? candidate.title : 'Untitled';
        const occurrenceCount = contexts.length;

        contexts.forEach(({ snippet, section }, occurrenceIndex) => {
            backlinks.push({
                direction: 'in',
                id: `${candidate.id}:${occurrenceIndex}`,
                noteId: candidate.id,
                occurrenceIndex,
                occurrenceCount,
                title,
                notebookName,
                section,
                snippet,
            });
        });
    }

    backlinks.sort(compareLinkItems);

    logger.debug('Resolved backlinks', { noteId, count: backlinks.length });
    return backlinks;
}
