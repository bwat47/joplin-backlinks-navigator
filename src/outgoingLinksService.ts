/**
 * Outgoing-link discovery (plugin host side).
 *
 * Finds every distinct destination the current note links to via Joplin's internal link syntax
 * `[text](:/<noteId>)` or `[text](:/<noteId>#<anchor>)`. Unlike backlinks, this needs no FTS
 * search: the current note's own body is fetched and its `:/<id>` links are extracted directly.
 *
 * Strategy:
 * 1. Fetch the current note's body.
 * 2. Extract every `:/<id>` occurrence and its optional heading anchor, in document order.
 * 3. Group by target id *and* anchor, skipping self-links and ignored notes. A link to a note and a
 *    link to one of its headings are different destinations, so they get their own rows; repeats of
 *    either collapse into one row.
 * 4. Resolve each target's title, parent notebook, and body, dropping broken links that can't be
 *    resolved. The snippet previews the opening of the linked note — or of the anchored section —
 *    rather than the context around the link in the current note.
 *
 * Only the plugin host has Data API access, so this runs here rather than in the content script.
 */

import joplin from 'api';
import logger from './logger';
import type { LinkItem } from './types';
import {
    extractNoteLinks,
    extractNoteOpening,
    extractSectionOpening,
    findHeadingByAnchor,
    parseMarkdownHeadings,
    type MarkdownHeading,
} from './linkExtraction';
import { resolveNoteMeta, resolveNotebookName, type NoteMeta } from './noteMetadata';
import { compareLinkItems } from './linkSort';

interface FindOutgoingLinksOptions {
    ignoredNoteIds?: ReadonlySet<string>;
}

/** Builds the row id / grouping key for a destination. */
function destinationKey(targetId: string, anchor: string): string {
    return anchor ? `${targetId}#${anchor}` : targetId;
}

/**
 * Finds all distinct destinations that the given note links to.
 *
 * @param noteId - ID of the note to read outgoing links from.
 * @param options - Optional filters, including note ids to omit from results.
 * @returns One entry per distinct note + heading-anchor pair, sorted by title. Returns `[]` on
 *   failure.
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

    // Group occurrences by destination (target id + anchor), counting links per group (document order).
    const groups = new Map<string, { targetId: string; anchor: string; count: number }>();
    occurrences.forEach((occurrence) => {
        const { targetId, anchor } = occurrence;
        if (targetId === noteId.toLowerCase() || ignoredNoteIds.has(targetId)) {
            return;
        }
        const key = destinationKey(targetId, anchor);
        const existing = groups.get(key);
        if (existing) {
            existing.count += 1;
        } else {
            groups.set(key, { targetId, anchor, count: 1 });
        }
    });

    const noteMetaCache = new Map<string, NoteMeta | null>();
    const notebookCache = new Map<string, string>();
    const headingCache = new Map<string, MarkdownHeading[]>();
    const outgoing: LinkItem[] = [];

    for (const [key, group] of groups) {
        const meta = await resolveNoteMeta(group.targetId, noteMetaCache, { includeBody: true });
        if (!meta) {
            // Broken link (target note no longer exists) — nothing to navigate to.
            continue;
        }
        const notebookName = await resolveNotebookName(meta.parent_id, notebookCache);
        let headings = headingCache.get(group.targetId);
        if (!headings) {
            headings = parseMarkdownHeadings(meta.body);
            headingCache.set(group.targetId, headings);
        }
        // An anchored link lands on a heading, so name that heading and preview the section under
        // it. If the anchor no longer resolves (heading renamed, or it points at something that
        // isn't a heading) fall back to the raw slug and the note's opening.
        const heading = group.anchor ? findHeadingByAnchor(headings, group.anchor) : null;
        const headingIndex = heading ? headings.indexOf(heading) : -1;
        const nextHeading = headingIndex >= 0 ? headings[headingIndex + 1] : undefined;
        const sectionEndLineIndex = nextHeading?.startLineIndex ?? meta.body.split('\n').length;
        outgoing.push({
            direction: 'out',
            id: key,
            noteId: group.targetId,
            anchor: group.anchor,
            occurrenceIndex: 0,
            occurrenceCount: group.count,
            title: meta.title,
            notebookName,
            section: heading ? heading.text : group.anchor,
            snippet: heading
                ? extractSectionOpening(meta.body, heading.endLineIndex, sectionEndLineIndex)
                : extractNoteOpening(meta.body, headings),
        });
    }

    outgoing.sort(compareLinkItems);

    logger.debug('Resolved outgoing links', { noteId, count: outgoing.length });
    return outgoing;
}
