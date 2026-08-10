/**
 * Backlink discovery (plugin host side).
 *
 * Finds every note whose body contains a rendered Markdown link to a given note, using either
 * inline syntax (`[text](:/<noteId>)`) or a valid reference-style link.
 *
 * Strategy:
 * 1. Search the Data API for the note id token. A note id is a 32-char hex
 *    string, indexed by FTS as a single token, so this returns candidate notes.
 * 2. Parse each candidate's rendered Markdown links to drop loose/code/example matches, and capture
 *    each matching link use as a backlink row.
 * 3. Resolve each candidate's parent notebook title (cached per call).
 *
 * Steps 1 and 2 are shared by {@link findBacklinks} and {@link countBacklinks}; only the former
 * pays for step 3 and for parsing each candidate body into snippets and section headings.
 *
 * Only the plugin host has Data API access, so this runs here rather than in
 * the content script.
 */

import joplin from 'api';
import logger from '../logger';
import type { LinkItem } from '../types';
import { extractNoteLinks, linkNeedle, type NoteLinkOccurrence } from '../markdown/linkExtraction';
import { parseMarkdownBody, type ParsedMarkdownBody } from '../markdown/markdownParser';
import { resolveNotebookName } from './noteMetadata';
import { compareLinkItems } from '../linkSort';
import { extractOccurrenceContexts } from '../markdown/snippetExtraction';

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

/** A search hit confirmed to contain one or more rendered links to the target note. */
interface BacklinkCandidate {
    note: SearchNote;
    parsed: ParsedMarkdownBody;
    occurrences: NoteLinkOccurrence[];
}

/**
 * Searches for and verifies the notes linking to `noteId` — the discovery work shared by
 * {@link findBacklinks} and {@link countBacklinks}.
 *
 * @returns One entry per linking note, in search order. Returns `[]` if the search fails.
 */
async function collectBacklinkCandidates(
    noteId: string,
    ignoredNoteIds: ReadonlySet<string>
): Promise<BacklinkCandidate[]> {
    const normalizedNoteId = noteId.toLowerCase();
    const needle = linkNeedle(normalizedNoteId);
    const searchHits: SearchNote[] = [];

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
                searchHits.push(...response.items);
            }

            hasMore = Boolean(response?.has_more);
            page += 1;
        }
    } catch (error) {
        logger.error('Backlink search failed', { noteId, error });
        return [];
    }

    const candidates: BacklinkCandidate[] = [];
    for (const note of searchHits) {
        // Drop the note itself and any candidate that doesn't actually contain the link.
        if (note.id.toLowerCase() === normalizedNoteId || ignoredNoteIds.has(note.id.toLowerCase())) {
            continue;
        }
        if (typeof note.body !== 'string' || !note.body.toLowerCase().includes(needle)) {
            continue;
        }

        const parsed = parseMarkdownBody(note.body);
        const occurrences = extractNoteLinks(parsed).filter((occurrence) => occurrence.targetId === normalizedNoteId);
        if (!occurrences.length) {
            continue;
        }

        candidates.push({ note, parsed, occurrences });
    }

    return candidates;
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

    const candidates = await collectBacklinkCandidates(noteId, options.ignoredNoteIds ?? new Set<string>());
    const notebookCache = new Map<string, string>();
    const backlinks: LinkItem[] = [];

    for (const { note, parsed, occurrences } of candidates) {
        const contexts = extractOccurrenceContexts(
            parsed,
            occurrences.map((occurrence) => occurrence.from)
        );
        const notebookName = await resolveNotebookName(note.parent_id, notebookCache);
        const title = typeof note.title === 'string' && note.title ? note.title : 'Untitled';
        const occurrenceCount = contexts.length;

        contexts.forEach(({ snippet, section }, occurrenceIndex) => {
            backlinks.push({
                direction: 'in',
                id: `${note.id}:${occurrenceIndex}`,
                noteId: note.id,
                // Backlinks navigate to an occurrence in the source note, never to a heading.
                anchor: '',
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

/** Backlink tallies, matching the rows {@link findBacklinks} would return for the same note. */
export interface BacklinkCounts {
    /** One per backlink row: every occurrence across every linking note. */
    occurrences: number;
    /** Distinct notes that link here. */
    notes: number;
}

/**
 * Counts the backlinks to the given note without building rows for them.
 *
 * Drives the indicator badge, which needs only the tallies: this skips the per-candidate
 * snippet/section parsing and notebook lookups that {@link findBacklinks} performs.
 *
 * @returns Backlink tallies. Returns zeros on failure.
 */
export async function countBacklinks(noteId: string, options: FindBacklinksOptions = {}): Promise<BacklinkCounts> {
    if (!noteId) {
        return { occurrences: 0, notes: 0 };
    }

    const candidates = await collectBacklinkCandidates(noteId, options.ignoredNoteIds ?? new Set<string>());
    const counts: BacklinkCounts = {
        occurrences: candidates.reduce((total, candidate) => total + candidate.occurrences.length, 0),
        notes: candidates.length,
    };

    logger.debug('Counted backlinks', { noteId, ...counts });
    return counts;
}
