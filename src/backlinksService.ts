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

/** Matches an ATX heading line, capturing the heading text. e.g. "## References" -> "References" */
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/**
 * Cleans a raw markdown line into readable prose:
 * - converts `![alt](url)` and `[text](url)` to their text/alt
 * - strips leading block markers (list bullets, task checkboxes, blockquotes, heading hashes)
 * - collapses whitespace and truncates to {@link SNIPPET_MAX_LENGTH}
 *
 * Note links (`:/<id>`) are removed along with every other link URL, so the raw 32-char id
 * never surfaces in the UI.
 */
function cleanSnippetLine(line: string): string {
    const cleaned = line
        // Images first (so the leading "!" doesn't survive the link pass), then links.
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        // Leading block markers: blockquote, heading hashes, task checkbox, list bullet/number.
        .replace(/^\s*>+\s?/, '')
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleaned.length <= SNIPPET_MAX_LENGTH) {
        return cleaned;
    }
    return `${cleaned.slice(0, SNIPPET_MAX_LENGTH - 1)}…`;
}

/**
 * Finds the nearest ATX heading at or above the link line, returning its text (no `#`).
 *
 * @returns The section heading text, or an empty string if the link isn't under a heading.
 */
function findSection(lines: string[], linkLineIndex: number): string {
    for (let i = linkLineIndex; i >= 0; i--) {
        const match = HEADING_RE.exec(lines[i]);
        if (match) {
            return match[1].trim();
        }
    }
    return '';
}

/**
 * Extracts display context for a backlink: a cleaned prose snippet of the first line that
 * references `noteId`, plus the section heading that line sits under.
 */
function extractContext(body: string, noteId: string): { snippet: string; section: string } {
    const needle = linkNeedle(noteId);
    const lines = body.split('\n');
    const linkLineIndex = lines.findIndex((line) => line.includes(needle));

    if (linkLineIndex === -1) {
        return { snippet: '', section: '' };
    }

    return {
        snippet: cleanSnippetLine(lines[linkLineIndex]),
        section: findSection(lines, linkLineIndex),
    };
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
        const { snippet, section } = extractContext(candidate.body, noteId);
        backlinks.push({
            id: candidate.id,
            title: typeof candidate.title === 'string' && candidate.title ? candidate.title : 'Untitled',
            notebookName,
            section,
            snippet,
        });
    }

    backlinks.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

    logger.debug('Resolved backlinks', { noteId, count: backlinks.length });
    return backlinks;
}
