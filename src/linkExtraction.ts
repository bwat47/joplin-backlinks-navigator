/**
 * Pure helpers for finding and describing Joplin internal links (`[text](:/<noteId>)`) in
 * markdown bodies. Shared by the backlink and outgoing-link services. No Joplin API access here,
 * so this module is straightforward to unit test.
 */

import uslug from '@joplin/fork-uslug';
import type { SyntaxNode } from '@lezer/common';
import { parser as markdownSyntaxParser } from '@lezer/markdown';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

const SNIPPET_MAX_LENGTH = 120;
// Joplin renders Markdown with inline HTML enabled. Parsing it the same way keeps tag names out of
// the visible heading text that is passed to the slugger.
const markdownParser = new MarkdownIt({ html: true });

/**
 * Markdown source and the shared structures derived from it. Callers create one context per body
 * and reuse it for heading, HTML-anchor, and snippet extraction.
 */
export interface ParsedMarkdownBody {
    readonly body: string;
    readonly tokens: readonly Token[];
    readonly lineStarts: readonly number[];
    readonly lines: readonly string[];
}

/** Tokenizes a Markdown body once and prepares the line indexes derived from it. */
export function parseMarkdownBody(body: string): ParsedMarkdownBody {
    const lines = body.split('\n');
    // Ascending line-start offsets (index 0 is offset 0), accumulated from the split rather than by
    // rescanning the body. +1 accounts for the newline that split() removed.
    const lineStarts = [0];
    for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex++) {
        lineStarts.push(lineStarts[lineIndex] + lines[lineIndex].length + 1);
    }

    return {
        body,
        tokens: markdownParser.parse(body, {}),
        lineStarts,
        lines,
    };
}

/**
 * Matches a complete Joplin note-link destination: a 32-char hex id after `:/`, optionally followed
 * by an anchor. Anchoring both ends prevents malformed longer ids, paths, and query strings from
 * being treated as links to the first 32 characters.
 */
const NOTE_LINK_DESTINATION_RE = /^:\/([0-9a-fA-F]{32})(?:#([\s\S]*))?$/;

/** Matches a thematic break / horizontal rule, e.g. "---", "***", "___". */
const THEMATIC_BREAK_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/**
 * Matches an HTML opening tag, e.g. `<a id="in3b65">`. Group 1 is the tag name. Excluding angle
 * brackets from the tag body ensures malformed input cannot make later `<` candidates repeatedly
 * rescan the rest of the string.
 */
const HTML_OPEN_TAG_RE = /<([a-z][a-z0-9-]*)\b[^<>]*>/gi;

/**
 * Matches an `id` or `name` attribute within an opening tag. Groups 1/2/3 hold the value from a
 * double-quoted, single-quoted, or unquoted attribute.
 *
 * The attribute name must be preceded by whitespace so prefixed attributes (`data-id`,
 * `data-name`) aren't mistaken for anchors, and the match is case-insensitive because HTML
 * attribute names are (`<a ID="Top">` is a valid anchor).
 */
const HTML_ANCHOR_ATTRIBUTE_RE = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/**
 * Builds a matcher for `tagName`'s closing tag, e.g. `</a>` or `</A >`, used to find where an
 * anchor element ends. Interpolation is safe without escaping because {@link HTML_OPEN_TAG_RE} only
 * ever captures a tag name matching `[a-z][a-z0-9-]*` case-insensitively.
 */
function closeTagRe(tagName: string): RegExp {
    return new RegExp(`</${tagName}\\s*>`, 'i');
}

/** Matches any HTML tag, used to strip tags out of anchor previews. */
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

/** Matches an inline-code span so its contents can be excluded from HTML-anchor scanning. */
const INLINE_CODE_RE = /`[^`\n]*`/g;

/**
 * Matches a leading GitHub/Obsidian alert (callout) marker, e.g. "[!NOTE]", "[!warning]-",
 * "[!tip]+ Title" — matched against a line already stripped of its blockquote `>`. The marker is
 * dropped; any trailing title text on the same line is kept.
 */
const ALERT_MARKER_RE = /^\[!\w+\][+-]?\s*/;

/** Builds the literal link prefix to look for in a note body. */
export function linkNeedle(noteId: string): string {
    return `:/${noteId}`;
}

/**
 * Cleans a raw markdown line into readable prose:
 * - converts `![alt](url)` and `[text](url)` to their text/alt
 * - strips leading block markers (list bullets, task checkboxes, blockquotes, heading hashes)
 * - collapses whitespace and truncates to {@link SNIPPET_MAX_LENGTH}
 *
 * Note links (`:/<id>`) are removed along with every other link URL, so the raw 32-char id
 * never surfaces in the UI.
 */
export function cleanSnippetLine(line: string): string {
    // Images first (so the leading "!" doesn't survive the link pass), then links.
    const withoutLinkDestinations = unwrapMarkdownLinks(unwrapMarkdownLinks(line, '!['), '[');
    const cleaned = withoutLinkDestinations
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
 * Replaces simple Markdown links/images with their label using a linear delimiter scan.
 *
 * This deliberately mirrors the previous regex behavior: labels end at the first `]`, destinations
 * end at the first `)`, and nested Markdown constructs are not parsed recursively.
 */
function unwrapMarkdownLinks(value: string, openingMarker: '![' | '['): string {
    const pieces: string[] = [];
    let unchangedStart = 0;
    let searchStart = 0;

    while (searchStart < value.length) {
        const opening = value.indexOf(openingMarker, searchStart);
        if (opening === -1) {
            break;
        }
        const labelStart = opening + openingMarker.length;
        const labelEnd = value.indexOf(']', labelStart);
        if (labelEnd === -1) {
            break;
        }
        if (value[labelEnd + 1] !== '(') {
            searchStart = labelEnd + 1;
            continue;
        }
        const destinationEnd = value.indexOf(')', labelEnd + 2);
        if (destinationEnd === -1) {
            break;
        }

        pieces.push(value.slice(unchangedStart, opening), value.slice(labelStart, labelEnd));
        unchangedStart = destinationEnd + 1;
        searchStart = unchangedStart;
    }

    pieces.push(value.slice(unchangedStart));
    return pieces.join('');
}

function extractOpening(
    parsed: ParsedMarkdownBody,
    startLineIndex: number,
    endLineIndex: number,
    headings: readonly MarkdownHeading[]
): string {
    const { lines } = parsed;
    const headingsByStartLine = new Map(headings.map((heading) => [heading.startLineIndex, heading]));
    let headingFallback = '';
    let lineIndex = startLineIndex;

    while (lineIndex < Math.min(endLineIndex, lines.length)) {
        const heading = headingsByStartLine.get(lineIndex);
        if (heading) {
            if (!headingFallback) {
                headingFallback = heading.text;
            }
            lineIndex = heading.endLineIndex;
            continue;
        }

        const line = lines[lineIndex];
        if (THEMATIC_BREAK_RE.test(line)) {
            lineIndex += 1;
            continue;
        }
        const cleaned = cleanSnippetLine(line).replace(ALERT_MARKER_RE, '');
        if (!cleaned) {
            lineIndex += 1;
            continue;
        }
        return cleaned;
    }
    return headingFallback;
}

/**
 * Builds a snippet from the beginning of a note body, used to preview where an outgoing link
 * leads (rather than the context around the link in the current note).
 *
 * Skips blank lines and thematic breaks, drops leading GitHub/Obsidian alert markers (`[!NOTE]`
 * and friends), and skips a leading heading — the first heading is usually the note's own title,
 * which the panel already shows separately — to surface the first line of actual prose. If the note
 * contains only headings, the first heading's text is used as a fallback so the snippet is never
 * empty for a non-empty note.
 */
export function extractNoteOpening(
    parsed: ParsedMarkdownBody,
    headings: readonly MarkdownHeading[] = parseMarkdownHeadings(parsed)
): string {
    return extractOpening(parsed, 0, parsed.lines.length, headings);
}

/**
 * Builds a snippet from the beginning of a heading's section without crossing into the next
 * heading. Empty sections return an empty snippet rather than borrowing prose from a later section.
 *
 * @param startLineIndex - First line after the target heading.
 * @param endLineIndex - First line of the next heading, or the note's line count.
 */
export function extractSectionOpening(
    parsed: ParsedMarkdownBody,
    startLineIndex: number,
    endLineIndex: number
): string {
    return extractOpening(parsed, startLineIndex, endLineIndex, []);
}

/**
 * Finds the nearest parsed heading at or above the link line, returning its rendered text.
 *
 * @returns The section heading text, or an empty string if the link isn't under a heading.
 */
export function findSection(headings: readonly MarkdownHeading[], linkLineIndex: number): string {
    for (let i = headings.length - 1; i >= 0; i--) {
        if (headings[i].startLineIndex <= linkLineIndex) {
            return headings[i].text;
        }
    }
    return '';
}

/**
 * Builds the anchor slug for a heading's rendered inline text using Joplin's `uslug` fork.
 *
 * e.g. "Getting Started with MERN Stack" -> "getting-started-with-mern-stack"
 */
export function slugifyHeading(text: string): string {
    return uslug(text);
}

/** A Markdown heading and its generated anchor/source range. */
export interface MarkdownHeading {
    /**
     * Generated anchor slug, including duplicate disambiguation. The first unsluggable heading has
     * an empty anchor; later unsluggable headings receive `-2`, `-3`, and so on.
     */
    anchor: string;
    /** Rendered inline heading text. */
    text: string;
    /** Heading level from 1 through 6. */
    level: number;
    /** Zero-based first source line occupied by the heading. */
    startLineIndex: number;
    /** Zero-based first source line after the heading. */
    endLineIndex: number;
    /** Offset of the start of the heading source in the body. */
    from: number;
    /** Offset immediately after the heading source, excluding a trailing line break. */
    to: number;
}

/**
 * Parses the headings rendered from a Markdown body, excluding heading-like text in code blocks.
 *
 * Repeated slugs are disambiguated the way Joplin's renderer does it: the first heading keeps the
 * bare slug and later ones are numbered from two (`intro`, `intro-2`, `intro-3`, …).
 */
export function parseMarkdownHeadings(parsed: ParsedMarkdownBody): MarkdownHeading[] {
    const { body, lineStarts, tokens } = parsed;

    const seenSlugs = new Set<string>();
    const headings: MarkdownHeading[] = [];

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex];
        if (token.type !== 'heading_open' || !token.map) {
            continue;
        }

        const inlineToken = tokens[tokenIndex + 1];
        if (inlineToken?.type !== 'inline') {
            continue;
        }

        // Joplin's anchor renderer derives heading titles from text and inline-code tokens. Link
        // labels contribute text children, while image alt text and raw HTML tags do not.
        const text = (inlineToken.children ?? [])
            .filter((child) => child.type === 'text' || child.type === 'code_inline')
            .map((child) => child.content)
            .join('');
        const baseSlug = slugifyHeading(text);
        let anchor = baseSlug;
        let counter = 1;
        while (seenSlugs.has(anchor)) {
            counter += 1;
            anchor = `${baseSlug}-${counter}`;
        }
        seenSlugs.add(anchor);

        const [startLineIndex, endLineIndex] = token.map;
        const from = lineStarts[startLineIndex] ?? body.length;
        let to = endLineIndex < lineStarts.length ? lineStarts[endLineIndex] - 1 : body.length;
        if (to > from && body[to - 1] === '\r') {
            to -= 1;
        }

        headings.push({
            anchor,
            text,
            level: Number(token.tag.slice(1)),
            startLineIndex,
            endLineIndex,
            from,
            to,
        });
    }

    return headings;
}

/**
 * Locates the parsed heading an anchor such as `getting-started-with-mern-stack` refers to.
 *
 * @returns The matching heading, or `null` when the anchor doesn't name one.
 */
export function findHeadingByAnchor(headings: readonly MarkdownHeading[], anchor: string): MarkdownHeading | null {
    const target = anchor.trim().toLowerCase();
    return target ? (headings.find((heading) => heading.anchor === target) ?? null) : null;
}

/**
 * An explicit HTML anchor found in a Markdown body — a tag carrying an `id`/`name` attribute, e.g.
 * `<a id="in3b65">The MERN stack</a>`. These are navigable link targets in Joplin just like heading
 * slugs, but they are not headings, so they need their own index.
 */
export interface HtmlAnchor {
    /** Lowercased anchor id/name, matched case-insensitively against a link fragment. */
    id: string;
    /** Readable label: the element's own inline text, or '' when the anchor has none. */
    text: string;
    /** Cleaned prose preview of the line the anchor sits on (HTML tags stripped). */
    snippet: string;
    /** Offset of the anchor tag's start in the body. */
    from: number;
    /**
     * Offset immediately after the anchor: the end of the closing tag when the element is closed
     * within its region, so the whole element (`<a id="x">label</a>`) is covered; otherwise the end
     * of the opening tag.
     */
    to: number;
}

/**
 * Token types whose source range may contain an inline or block-level HTML anchor. Table cells
 * carry no source map of their own, so `tr_open` (which does) covers anchors written in a table.
 */
const HTML_ANCHOR_TOKEN_TYPES = new Set(['html_block', 'heading_open', 'paragraph_open', 'tr_open']);

/** Returns the index of the line containing `offset` given ascending `lineStarts`. */
function offsetToLineIndex(lineStarts: readonly number[], offset: number): number {
    let lo = 0;
    let hi = lineStarts.length - 1;
    let result = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lineStarts[mid] <= offset) {
            result = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}

/**
 * Removes HTML tags so an anchor's surrounding markup doesn't leak into its preview.
 *
 * Runs until the text stops changing: a single pass can splice a new tag back together out of
 * nested or malformed markup (`<<a>script>` -> `<script>`), which would put the very markup this
 * strips right back into the snippet. Each pass only ever shortens the string, so this terminates.
 */
function stripHtmlTags(value: string): string {
    let current = value;
    let previous: string;
    do {
        previous = current;
        current = current.replace(HTML_TAG_RE, '');
    } while (current !== previous);
    return current;
}

/**
 * Blanks out inline-code spans (preserving length so offsets stay aligned) so an `id=`/`name=`
 * written inside inline code, e.g. `` `<a id="x">` ``, isn't mistaken for a real anchor.
 */
function maskInlineCode(value: string): string {
    return value.replace(INLINE_CODE_RE, (span) => ' '.repeat(span.length));
}

/** Cleaned prose of the first non-empty line at or after `lineIndex`, with HTML tags removed. */
function anchorSnippet(lines: readonly string[], lineIndex: number): string {
    const limit = Math.min(lineIndex + 5, lines.length);
    for (let index = lineIndex; index < limit; index++) {
        const cleaned = cleanSnippetLine(stripHtmlTags(lines[index]));
        if (cleaned) {
            return cleaned;
        }
    }
    return '';
}

/** Returns an opening tag's normalized anchor id/name, or an empty string when it has none. */
function htmlAnchorId(openingTag: string): string {
    const attribute = HTML_ANCHOR_ATTRIBUTE_RE.exec(openingTag);
    return (attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? '').trim().toLowerCase();
}

/**
 * Builds one anchor after its opening tag and id/name attribute have been identified.
 *
 * When the element is closed within `region`, its content becomes the label and the range covers the
 * whole element, so navigating to the anchor highlights all of it rather than just the opening tag.
 * A block-level tag closed past a blank line lands in a separate token, so it keeps only the
 * opening-tag range.
 */
function createHtmlAnchor(
    parsed: ParsedMarkdownBody,
    region: string,
    regionStart: number,
    match: RegExpExecArray,
    id: string
): HtmlAnchor {
    const { lines, lineStarts } = parsed;
    const from = regionStart + match.index;
    let to = from + match[0].length;
    let text = '';
    const rest = region.slice(match.index + match[0].length);
    const close = closeTagRe(match[1]).exec(rest);

    if (close) {
        text = cleanSnippetLine(stripHtmlTags(rest.slice(0, close.index)));
        to += close.index + close[0].length;
    }

    return {
        id,
        text,
        snippet: anchorSnippet(lines, offsetToLineIndex(lineStarts, from)),
        from,
        to,
    };
}

/**
 * Parses explicit HTML anchors (`<tag id="…">` / `<tag name="…">`) from a Markdown body.
 *
 * Only prose, table-row, and HTML-block regions are scanned, so anchors written inside fenced or
 * inline code are ignored — matching the way Joplin renders them (code is never a link target).
 * When the element is closed inside the region its own text becomes the anchor's readable label and
 * its range spans the whole element; an unclosed tag gets no label and covers just the opening tag.
 * Duplicate ids are kept as separate entries; {@link findHtmlAnchorById} returns the first one,
 * mirroring how a fragment link lands on the first matching id.
 */
export function parseHtmlAnchors(parsed: ParsedMarkdownBody): HtmlAnchor[] {
    const { body, lineStarts, tokens } = parsed;
    const anchors: HtmlAnchor[] = [];
    const seenOffsets = new Set<number>();

    for (const token of tokens) {
        if (!token.map || !HTML_ANCHOR_TOKEN_TYPES.has(token.type)) {
            continue;
        }
        const [startLine, endLine] = token.map;
        const regionStart = lineStarts[startLine] ?? body.length;
        const regionEnd = endLine < lineStarts.length ? lineStarts[endLine] : body.length;
        const region = body.slice(regionStart, regionEnd);
        // Scan a copy with inline code blanked out; offsets still line up with `region`.
        const scanText = maskInlineCode(region);

        HTML_OPEN_TAG_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = HTML_OPEN_TAG_RE.exec(scanText)) !== null) {
            const id = htmlAnchorId(match[0]);
            if (!id) {
                continue;
            }
            const from = regionStart + match.index;
            // Container tokens (e.g. a paragraph inside a blockquote) can overlap; keep one row per tag.
            if (seenOffsets.has(from)) {
                continue;
            }
            seenOffsets.add(from);
            anchors.push(createHtmlAnchor(parsed, region, regionStart, match, id));
        }
    }

    return anchors;
}

/**
 * Locates the HTML anchor an id fragment such as `in3b65` refers to.
 *
 * @returns The first matching anchor, or `null` when the id names none.
 */
export function findHtmlAnchorById(anchors: readonly HtmlAnchor[], anchorId: string): HtmlAnchor | null {
    const target = anchorId.trim().toLowerCase();
    return target ? (anchors.find((anchor) => anchor.id === target) ?? null) : null;
}

/** A single internal-link occurrence found in a note body. */
export interface NoteLinkOccurrence {
    /** Lowercased 32-char target note id. */
    targetId: string;
    /**
     * URL-decoded, lowercased heading anchor following the id (`#…`); empty when the link has none.
     */
    anchor: string;
    /** Offset of the start of the rendered Markdown link syntax in the body. */
    from: number;
    /** Offset immediately after the rendered Markdown link syntax in the body. */
    to: number;
}

/**
 * Decodes a resource URL fragment the same way Joplin does, including treating `+` as a space.
 * Malformed percent escapes are preserved so one bad link cannot abort discovery for the note.
 */
function normalizeLinkAnchor(anchor: string): string {
    try {
        return decodeURIComponent(anchor.replace(/\+/g, '%20')).toLowerCase();
    } catch {
        return anchor.toLowerCase();
    }
}

/** Normalizes a reference label using CommonMark's whitespace and Unicode case-folding rules. */
function normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase();
}

/** Parses and unescapes a URL node exactly as markdown-it parses a link destination. */
function parseLinkDestination(body: string, urlNode: SyntaxNode): string | null {
    const source = body.slice(urlNode.from, urlNode.to);
    const parsed = markdownParser.helpers.parseLinkDestination(source, 0, source.length);
    return parsed.ok && parsed.pos === source.length ? parsed.str : null;
}

/** Returns a link's primary label (the text between its first `[` and `]` markers). */
function primaryLinkLabel(body: string, linkNode: SyntaxNode): string {
    const marks = linkNode.getChildren('LinkMark');
    return marks.length >= 2 ? body.slice(marks[0].to, marks[1].from) : '';
}

/** Resolves the normalized reference label used by a full, collapsed, or shortcut link. */
function linkReferenceLabel(body: string, linkNode: SyntaxNode): string {
    const explicitLabel = linkNode.getChild('LinkLabel');
    const explicitText = explicitLabel ? body.slice(explicitLabel.from + 1, explicitLabel.to - 1) : '';
    return normalizeReferenceLabel(explicitText || primaryLinkLabel(body, linkNode));
}

/** Parses one already-unescaped Markdown destination as a Joplin note target. */
function parseNoteLinkDestination(destination: string): Pick<NoteLinkOccurrence, 'targetId' | 'anchor'> | null {
    const match = NOTE_LINK_DESTINATION_RE.exec(destination);
    if (!match) {
        return null;
    }
    return {
        targetId: match[1].toLowerCase(),
        anchor: normalizeLinkAnchor(match[2] ?? ''),
    };
}

/**
 * Finds every rendered Markdown note link (`:/<id>`, optionally `#<anchor>`) in document order.
 *
 * Inline links and valid full/collapsed/shortcut reference links are included. Images, raw HTML,
 * bare destinations, code, comments, invalid references, and malformed destinations are excluded.
 */
export function extractNoteLinks(body: string): NoteLinkOccurrence[] {
    const tree = markdownSyntaxParser.parse(body);
    const references = new Map<string, string>();
    const occurrences: NoteLinkOccurrence[] = [];

    // Lezer deliberately recognizes reference-looking links without checking whether a definition
    // exists. Build the definition index ourselves so only links markdown-it would render survive.
    tree.iterate({
        enter: (cursor) => {
            if (cursor.name !== 'LinkReference') {
                return;
            }
            const labelNode = cursor.node.getChild('LinkLabel');
            const urlNode = cursor.node.getChild('URL');
            if (!labelNode || !urlNode) {
                return false;
            }
            const label = normalizeReferenceLabel(body.slice(labelNode.from + 1, labelNode.to - 1));
            const destination = parseLinkDestination(body, urlNode);
            if (label && destination !== null && !references.has(label)) {
                references.set(label, destination);
            }
            return false;
        },
    });

    tree.iterate({
        enter: (cursor) => {
            // An image may contain link-like label text, but it renders as an image rather than a
            // navigable note link, so neither it nor anything nested inside it is an occurrence.
            if (cursor.name === 'Image') {
                return false;
            }
            if (cursor.name !== 'Link') {
                return;
            }

            const urlNode = cursor.node.getChild('URL');
            const destination = urlNode
                ? parseLinkDestination(body, urlNode)
                : references.get(linkReferenceLabel(body, cursor.node));
            const target =
                destination === undefined || destination === null ? null : parseNoteLinkDestination(destination);
            if (target) {
                occurrences.push({
                    ...target,
                    from: cursor.from,
                    to: cursor.to,
                });
            }
            return false;
        },
    });

    return occurrences;
}

/** Display context for a single link occurrence. */
export interface OccurrenceContext {
    snippet: string;
    section: string;
}

/**
 * Resolves display context (cleaned snippet + enclosing section heading) for each offset.
 *
 * Offsets must be sorted ascending and must have been computed against `parsed.body` — they are
 * mapped to lines using that body's line starts. Returns one entry per input offset, in the same
 * order.
 */
export function extractOccurrenceContexts(parsed: ParsedMarkdownBody, offsets: number[]): OccurrenceContext[] {
    if (!offsets.length) {
        return [];
    }

    const { lines, lineStarts } = parsed;
    const headings = parseMarkdownHeadings(parsed);
    const contexts: OccurrenceContext[] = [];
    let offsetIndex = 0;

    for (let lineIndex = 0; lineIndex < lines.length && offsetIndex < offsets.length; lineIndex++) {
        const line = lines[lineIndex];
        const lineStartOffset = lineStarts[lineIndex] ?? parsed.body.length;
        const lineEndOffset = lineStartOffset + line.length;

        while (
            offsetIndex < offsets.length &&
            offsets[offsetIndex] >= lineStartOffset &&
            offsets[offsetIndex] <= lineEndOffset
        ) {
            contexts.push({
                snippet: cleanSnippetLine(line),
                section: findSection(headings, lineIndex),
            });
            offsetIndex += 1;
        }
    }

    return contexts;
}
