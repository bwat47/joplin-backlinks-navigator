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
 *    FTS matches, and capture the first matching line as a context snippet.
 * 3. Resolve each candidate's parent notebook title (cached per call).
 *
 * Only the plugin host has Data API access, so this runs here rather than in
 * the content script.
 */

import joplin from 'api';
import logger from './logger';
import type { BacklinkItem } from './types';

const SEARCH_PAGE_LIMIT = 100;
const SNIPPET_MAX_LENGTH = 120;

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

/** Builds the literal link prefix to look for in a candidate note's body. */
function linkNeedle(noteId: string): string {
    return `:/${noteId}`;
}

/**
 * Extracts a short snippet from the first body line that references `noteId`.
 *
 * @returns The trimmed/collapsed line text, or an empty string if not found.
 */
function extractSnippet(body: string, noteId: string): string {
    const needle = linkNeedle(noteId);
    const lines = body.split('\n');
    for (const line of lines) {
        if (line.includes(needle)) {
            const collapsed = line.replace(/\s+/g, ' ').trim();
            if (collapsed.length <= SNIPPET_MAX_LENGTH) {
                return collapsed;
            }
            return `${collapsed.slice(0, SNIPPET_MAX_LENGTH - 1)}…`;
        }
    }
    return '';
}

/**
 * Resolves a notebook title by id, memoizing lookups in `cache`.
 */
async function resolveNotebookName(parentId: string, cache: Map<string, string>): Promise<string> {
    if (!parentId) {
        return '';
    }
    const cached = cache.get(parentId);
    if (cached !== undefined) {
        return cached;
    }
    try {
        const folder = await joplin.data.get(['folders', parentId], { fields: ['id', 'title'] });
        const title = typeof folder?.title === 'string' ? folder.title : '';
        cache.set(parentId, title);
        return title;
    } catch (error) {
        logger.warn('Failed to resolve notebook name', { parentId, error });
        cache.set(parentId, '');
        return '';
    }
}

/**
 * Finds all notes that link to the given note.
 *
 * @param noteId - ID of the note to find backlinks for.
 * @returns Backlink entries sorted by note title. Returns `[]` on failure.
 */
export async function findBacklinks(noteId: string): Promise<BacklinkItem[]> {
    if (!noteId) {
        return [];
    }

    const needle = linkNeedle(noteId);
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
    const backlinks: BacklinkItem[] = [];

    for (const candidate of candidates) {
        // Drop the note itself and any candidate that doesn't actually contain the link.
        if (candidate.id === noteId) {
            continue;
        }
        if (typeof candidate.body !== 'string' || !candidate.body.includes(needle)) {
            continue;
        }

        const notebookName = await resolveNotebookName(candidate.parent_id, notebookCache);
        backlinks.push({
            id: candidate.id,
            title: typeof candidate.title === 'string' && candidate.title ? candidate.title : 'Untitled',
            notebookName,
            snippet: extractSnippet(candidate.body, noteId),
        });
    }

    backlinks.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

    logger.debug('Resolved backlinks', { noteId, count: backlinks.length });
    return backlinks;
}
