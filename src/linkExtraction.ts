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
    /** Generated anchor slug, including duplicate disambiguation; empty when text is unsluggable. */
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
    const lineStarts = [0];
    for (let offset = 0; offset < body.length; offset++) {
        if (body[offset] === '\n') {
            lineStarts.push(offset + 1);
        }
    }

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
        let anchor = '';
        if (baseSlug) {
            anchor = baseSlug;
            let counter = 1;
            while (seenSlugs.has(anchor)) {
                counter += 1;
                anchor = `${baseSlug}-${counter}`;
            }
            seenSlugs.add(anchor);
        }

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
    /** Heading anchor slug following the id (`#…`), lowercased; empty when the link has none. */
    anchor: string;
    /** Offset of the `:/` in the body. */
    offset: number;
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
            anchor: (match[2] ?? '').toLowerCase(),
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
