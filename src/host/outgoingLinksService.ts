/**
 * Outgoing-link discovery (plugin host side).
 *
 * Finds every distinct destination the current note links to through a rendered Markdown link,
 * including inline and valid reference-style links. Unlike backlinks, this needs no FTS search: the
 * current note's own body is fetched and parsed directly.
 *
 * Strategy:
 * 1. Fetch the current note's body.
 * 2. Extract every rendered note-link use and its optional heading anchor, in document order.
 * 3. Group by target id *and* anchor, skipping self-links and ignored notes. A link to a note and a
 *    link to one of its anchors are different destinations, so they get their own rows; repeats of
 *    either collapse into one row.
 * 4. Resolve each target's title, parent notebook, and body, dropping broken links that can't be
 *    resolved and targets that live in an ignored notebook. The snippet previews the opening of the linked note — or of the anchored section or
 *    HTML-anchor line — rather than the context around the link in the current note. An anchor
 *    resolves to a heading slug first, then to an explicit HTML anchor (`<a id="…">`).
 *
 * Steps 1-3 are shared with {@link countOutgoingLinks}, which applies step 4's notebook filter but
 * stops short of its body fetches and anchor parsing.
 *
 * Only the plugin host has Data API access, so this runs here rather than in the content script.
 */

import logger from '../logger';
import type { LinkFilters, LinkItem } from '../types';
import { findHtmlAnchorById, parseHtmlAnchors, type HtmlAnchor } from '../markdown/htmlAnchors';
import { extractNoteLinks } from '../markdown/linkExtraction';
import { findHeadingByAnchor, parseMarkdownHeadings, type MarkdownHeading } from '../markdown/markdownHeadings';
import { parseMarkdownBody, type ParsedMarkdownBody } from '../markdown/markdownParser';
import { resolveNoteMeta, resolveNotebookName } from './noteMetadata';
import { compareLinkItems } from '../linkSort';
import { extractNoteOpening, extractSectionOpening } from '../markdown/snippetExtraction';
import type { LinkRepository, NoteMeta } from './joplinRepository';

interface ParsedTargetBody {
    parsed: ParsedMarkdownBody;
    headings: MarkdownHeading[];
    htmlAnchors?: HtmlAnchor[];
}

/** A distinct destination (target note + optional anchor) and how many links point at it. */
interface Destination {
    /** Row id / grouping key, e.g. `<id>` or `<id>#<anchor>`. */
    key: string;
    targetId: string;
    anchor: string;
    count: number;
}

/** Builds the row id / grouping key for a destination. */
function destinationKey(targetId: string, anchor: string): string {
    return anchor ? `${targetId}#${anchor}` : targetId;
}

/** Reads a note's body. Returns `null` when the note can't be fetched. */
async function fetchNoteBody(repository: LinkRepository, noteId: string): Promise<string | null> {
    try {
        return await repository.getNoteBody(noteId);
    } catch (error) {
        logger.error('Outgoing link lookup failed', { noteId, error });
        return null;
    }
}

/**
 * Groups a note body's internal links into distinct destinations, in document order, skipping
 * self-links and ignored notes. A link to a note and a link to one of its anchors are different
 * destinations, so they get their own entries; repeats of either collapse into one.
 */
function collectDestinations(
    parsed: ParsedMarkdownBody,
    noteId: string,
    ignoredNoteIds: ReadonlySet<string>
): Destination[] {
    const groups = new Map<string, Destination>();

    for (const { targetId, anchor } of extractNoteLinks(parsed)) {
        if (targetId === noteId.toLowerCase() || ignoredNoteIds.has(targetId)) {
            continue;
        }
        const key = destinationKey(targetId, anchor);
        const existing = groups.get(key);
        if (existing) {
            existing.count += 1;
        } else {
            groups.set(key, { key, targetId, anchor, count: 1 });
        }
    }

    return [...groups.values()];
}

/**
 * Reports whether a resolved target should be dropped because it lives in an ignored notebook.
 *
 * Unlike ignored note ids, this can't be checked in {@link collectDestinations}: a destination is
 * only a target id until its metadata is resolved. Both the row and the count path already fetch
 * `parent_id`, so the check costs no extra lookup — and both must apply it, or the indicator badge
 * would drift out of step with the panel.
 */
function isInIgnoredNotebook(meta: NoteMeta, ignoredFolderIds: ReadonlySet<string>): boolean {
    return Boolean(meta.parent_id) && ignoredFolderIds.has(meta.parent_id);
}

/**
 * Resolves the label and preview text for one destination in an already-parsed target note.
 *
 * Where an anchored link lands, in priority order:
 *   1. a heading whose slug matches — name the heading, preview the section under it;
 *   2. an explicit HTML anchor (`<a id="…">`) — use its own text as the label and preview the line
 *      it sits on;
 *   3. neither (stale slug, renamed heading) — fall back to the raw slug and the note opening.
 *
 * An unanchored link previews the target note's opening and has no section label.
 */
function resolveDestinationPreview(targetBody: ParsedTargetBody, anchor: string): { section: string; snippet: string } {
    const { headings, parsed } = targetBody;
    const heading = anchor ? findHeadingByAnchor(headings, anchor) : null;

    if (heading) {
        const nextHeading = headings[headings.indexOf(heading) + 1];
        const sectionEndLineIndex = nextHeading?.startLineIndex ?? parsed.lines.length;
        return {
            section: heading.text,
            snippet: extractSectionOpening(parsed, heading.endLineIndex, sectionEndLineIndex),
        };
    }

    if (anchor) {
        targetBody.htmlAnchors ??= parseHtmlAnchors(parsed);
        const htmlAnchor = findHtmlAnchorById(targetBody.htmlAnchors, anchor);
        return {
            section: htmlAnchor?.text || anchor,
            snippet: htmlAnchor?.snippet || extractNoteOpening(parsed, headings),
        };
    }

    return { section: '', snippet: extractNoteOpening(parsed, headings) };
}

/**
 * Finds all distinct destinations that the given note links to.
 *
 * @param noteId - ID of the note to read outgoing links from.
 * @param filters - Optional exclusions; see {@link LinkFilters}.
 * @returns One entry per distinct note + anchor pair, sorted by title. Returns `[]` on failure.
 */
export async function findOutgoingLinks(
    repository: LinkRepository,
    noteId: string,
    filters: LinkFilters = {}
): Promise<LinkItem[]> {
    if (!noteId) {
        return [];
    }

    const body = await fetchNoteBody(repository, noteId);
    if (body === null) {
        return [];
    }

    const ignoredFolderIds = filters.ignoredFolderIds ?? new Set<string>();
    const destinations = collectDestinations(parseMarkdownBody(body), noteId, filters.ignoredNoteIds ?? new Set());
    if (!destinations.length) {
        return [];
    }

    const noteMetaCache = new Map<string, NoteMeta | null>();
    const notebookCache = new Map<string, string>();
    const parsedBodyCache = new Map<string, ParsedTargetBody>();
    const outgoing: LinkItem[] = [];

    for (const group of destinations) {
        const meta = await resolveNoteMeta(repository, group.targetId, noteMetaCache, { includeBody: true });
        if (!meta) {
            // Broken link (target note no longer exists) — nothing to navigate to.
            continue;
        }
        if (isInIgnoredNotebook(meta, ignoredFolderIds)) {
            continue;
        }
        const notebookName = await resolveNotebookName(repository, meta.parent_id, notebookCache);
        let targetBody = parsedBodyCache.get(group.targetId);
        if (!targetBody) {
            const parsed = parseMarkdownBody(meta.body);
            targetBody = {
                parsed,
                headings: parseMarkdownHeadings(parsed),
            };
            parsedBodyCache.set(group.targetId, targetBody);
        }
        const { section, snippet } = resolveDestinationPreview(targetBody, group.anchor);
        outgoing.push({
            direction: 'out',
            id: group.key,
            noteId: group.targetId,
            anchor: group.anchor,
            occurrenceIndex: 0,
            occurrenceCount: group.count,
            title: meta.title,
            notebookName,
            section,
            snippet,
        });
    }

    outgoing.sort(compareLinkItems);

    logger.debug('Resolved outgoing links', { noteId, count: outgoing.length });
    return outgoing;
}

/**
 * Counts the distinct destinations the given note links to, without building rows for them.
 *
 * Drives the indicator badge, which needs only the tally. Each destination still costs one note
 * lookup, because a link whose target no longer exists is broken and {@link findOutgoingLinks}
 * drops it — so counting it would put the badge out of step with the panel. The same lookup carries
 * the `parent_id` that the ignored-notebook filter needs. It omits the target's `body`, which is what makes this cheap: no bodies are transferred and no target note is
 * parsed for headings or HTML anchors.
 *
 * @returns The number of resolvable destinations. Returns 0 on failure.
 */
export async function countOutgoingLinks(
    repository: LinkRepository,
    noteId: string,
    filters: LinkFilters = {}
): Promise<number> {
    if (!noteId) {
        return 0;
    }

    const body = await fetchNoteBody(repository, noteId);
    if (body === null) {
        return 0;
    }

    const ignoredFolderIds = filters.ignoredFolderIds ?? new Set<string>();
    const destinations = collectDestinations(parseMarkdownBody(body), noteId, filters.ignoredNoteIds ?? new Set());
    const noteMetaCache = new Map<string, NoteMeta | null>();
    let count = 0;

    for (const destination of destinations) {
        const meta = await resolveNoteMeta(repository, destination.targetId, noteMetaCache);
        if (meta && !isInIgnoredNotebook(meta, ignoredFolderIds)) {
            count += 1;
        }
    }

    logger.debug('Counted outgoing links', { noteId, count });
    return count;
}
