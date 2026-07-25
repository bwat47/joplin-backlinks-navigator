/**
 * Pure helpers for finding and describing Joplin internal links (`[text](:/<noteId>)`) in
 * markdown bodies. Shared by the backlink and outgoing-link services. No Joplin API access here,
 * so this module is straightforward to unit test.
 */

import uslug from '@joplin/fork-uslug';
import MarkdownIt from 'markdown-it';

const SNIPPET_MAX_LENGTH = 120;
// Joplin renders Markdown with inline HTML enabled. Parsing it the same way keeps tag names out of
// the visible heading text that is passed to the slugger.
const markdownParser = new MarkdownIt({ html: true });

/**
 * Matches a 32-char hex Joplin note id immediately after `:/`, plus an optional heading anchor.
 * e.g. `:/7013f475748d41819ff9d21f084663d5#getting-started` -> id, "getting-started".
 * The anchor stops at whitespace or the closing `)` of the markdown link.
 */
const NOTE_LINK_RE = /:\/([0-9a-fA-F]{32})(?:#([^\s)\]]*))?/g;

/** Matches a thematic break / horizontal rule, e.g. "---", "***", "___". */
const THEMATIC_BREAK_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/**
 * Matches an HTML opening tag that carries an `id` or `name` attribute, e.g.
 * `<a id="in3b65">` or `<span name='foo'>`. Group 1 is the tag name; groups 2/3/4 hold the
 * id value from a double-quoted, single-quoted, or unquoted attribute.
 */
const HTML_ANCHOR_RE = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?\b(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>/g;

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

function extractOpening(
    body: string,
    startLineIndex: number,
    endLineIndex: number,
    headings: readonly MarkdownHeading[]
): string {
    const lines = body.split('\n');
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
    body: string,
    headings: readonly MarkdownHeading[] = parseMarkdownHeadings(body)
): string {
    return extractOpening(body, 0, body.split('\n').length, headings);
}

/**
 * Builds a snippet from the beginning of a heading's section without crossing into the next
 * heading. Empty sections return an empty snippet rather than borrowing prose from a later section.
 *
 * @param startLineIndex - First line after the target heading.
 * @param endLineIndex - First line of the next heading, or the note's line count.
 */
export function extractSectionOpening(body: string, startLineIndex: number, endLineIndex: number): string {
    return extractOpening(body, startLineIndex, endLineIndex, []);
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
export function parseMarkdownHeadings(body: string): MarkdownHeading[] {
    const tokens = markdownParser.parse(body, {});
    const lineStarts = computeLineStarts(body);

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
    /** Readable label: an `<a>` element's own inline text, or '' when the anchor has none. */
    text: string;
    /** Cleaned prose preview of the line the anchor sits on (HTML tags stripped). */
    snippet: string;
    /** Offset of the anchor tag's start in the body. */
    from: number;
    /** Offset immediately after the anchor's opening tag. */
    to: number;
}

/** Token types whose source range may contain an inline or block-level HTML anchor. */
const HTML_ANCHOR_TOKEN_TYPES = new Set(['html_block', 'heading_open', 'paragraph_open']);

/** Builds the ascending list of line-start offsets for `body` (index 0 is offset 0). */
function computeLineStarts(body: string): number[] {
    const lineStarts = [0];
    for (let offset = 0; offset < body.length; offset++) {
        if (body[offset] === '\n') {
            lineStarts.push(offset + 1);
        }
    }
    return lineStarts;
}

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

/** Removes HTML tags so an anchor's surrounding markup doesn't leak into its preview. */
function stripHtmlTags(value: string): string {
    return value.replace(HTML_TAG_RE, '');
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

/**
 * Parses explicit HTML anchors (`<tag id="…">` / `<tag name="…">`) from a Markdown body.
 *
 * Only prose and HTML-block regions are scanned, so anchors written inside fenced or inline code
 * are ignored — matching the way Joplin renders them (code is never turned into a link target). An
 * `<a>…</a>` element's own text becomes the anchor's readable label; other tags have no label.
 * Duplicate ids are kept as separate entries; {@link findHtmlAnchorById} returns the first one,
 * mirroring how a fragment link lands on the first matching id.
 */
export function parseHtmlAnchors(body: string): HtmlAnchor[] {
    const tokens = markdownParser.parse(body, {});
    const lineStarts = computeLineStarts(body);
    const lines = body.split('\n');
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

        HTML_ANCHOR_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = HTML_ANCHOR_RE.exec(scanText)) !== null) {
            const id = (match[2] ?? match[3] ?? match[4] ?? '').trim().toLowerCase();
            if (!id) {
                continue;
            }
            const from = regionStart + match.index;
            // Container tokens (e.g. a paragraph inside a blockquote) can overlap; keep one row per tag.
            if (seenOffsets.has(from)) {
                continue;
            }
            seenOffsets.add(from);
            const to = from + match[0].length;

            let text = '';
            if (match[1].toLowerCase() === 'a') {
                const rest = region.slice(match.index + match[0].length);
                const closeIndex = rest.search(/<\/a\s*>/i);
                if (closeIndex !== -1) {
                    text = cleanSnippetLine(stripHtmlTags(rest.slice(0, closeIndex)));
                }
            }

            anchors.push({
                id,
                text,
                snippet: anchorSnippet(lines, offsetToLineIndex(lineStarts, from)),
                from,
                to,
            });
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

/**
 * Finds the offset of every occurrence of `needle` in `text` (ascending order).
 */
export function findOccurrenceOffsets(text: string, needle: string): number[] {
    const offsets: number[] = [];
    let fromIndex = 0;

    while (fromIndex < text.length) {
        const offset = text.indexOf(needle, fromIndex);
        if (offset === -1) {
            break;
        }
        offsets.push(offset);
        fromIndex = offset + needle.length;
    }

    return offsets;
}

/** A single internal-link occurrence found in a note body. */
export interface NoteLinkOccurrence {
    /** Lowercased 32-char target note id. */
    targetId: string;
    /**
     * URL-decoded, lowercased heading anchor following the id (`#…`); empty when the link has none.
     */
    anchor: string;
    /** Offset of the `:/` in the body. */
    offset: number;
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

/**
 * Finds every internal note link (`:/<id>`, optionally `#<anchor>`) in `body`, in document order.
 */
export function extractNoteLinks(body: string): NoteLinkOccurrence[] {
    const occurrences: NoteLinkOccurrence[] = [];
    NOTE_LINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NOTE_LINK_RE.exec(body)) !== null) {
        occurrences.push({
            targetId: match[1].toLowerCase(),
            anchor: normalizeLinkAnchor(match[2] ?? ''),
            offset: match.index,
        });
    }
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
 * Offsets must be sorted ascending; each must fall on a line of `body`. Returns one entry per
 * input offset, in the same order.
 */
export function extractOccurrenceContexts(body: string, offsets: number[]): OccurrenceContext[] {
    if (!offsets.length) {
        return [];
    }

    const lines = body.split('\n');
    const headings = parseMarkdownHeadings(body);
    const contexts: OccurrenceContext[] = [];
    let lineStartOffset = 0;
    let offsetIndex = 0;

    for (let lineIndex = 0; lineIndex < lines.length && offsetIndex < offsets.length; lineIndex++) {
        const line = lines[lineIndex];
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

        // +1 accounts for the newline removed by split().
        lineStartOffset = lineEndOffset + 1;
    }

    return contexts;
}
