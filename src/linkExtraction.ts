/**
 * Pure helpers for finding and describing Joplin internal links (`[text](:/<noteId>)`) in
 * markdown bodies. Shared by the backlink and outgoing-link services. No Joplin API access here,
 * so this module is straightforward to unit test.
 */

const SNIPPET_MAX_LENGTH = 120;

/** Matches a 32-char hex Joplin note id immediately after `:/`. */
const NOTE_LINK_RE = /:\/([0-9a-fA-F]{32})/g;

/** Matches an ATX heading line, capturing the heading text. e.g. "## References" -> "References" */
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

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
export function extractNoteOpening(body: string): string {
    let headingFallback = '';
    for (const line of body.split('\n')) {
        if (THEMATIC_BREAK_RE.test(line)) {
            continue;
        }
        const cleaned = cleanSnippetLine(line).replace(ALERT_MARKER_RE, '');
        if (!cleaned) {
            continue;
        }
        if (HEADING_RE.test(line)) {
            if (!headingFallback) {
                headingFallback = cleaned;
            }
            continue;
        }
        return cleaned;
    }
    return headingFallback;
}

/**
 * Finds the nearest ATX heading at or above the link line, returning its text (no `#`).
 *
 * @returns The section heading text, or an empty string if the link isn't under a heading.
 */
export function findSection(lines: string[], linkLineIndex: number): string {
    for (let i = linkLineIndex; i >= 0; i--) {
        const match = HEADING_RE.exec(lines[i]);
        if (match) {
            return match[1].trim();
        }
    }
    return '';
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
    /** Offset of the `:/` in the body. */
    offset: number;
}

/**
 * Finds every internal note link (`:/<id>`) in `body`, in document order.
 */
export function extractNoteLinks(body: string): NoteLinkOccurrence[] {
    const occurrences: NoteLinkOccurrence[] = [];
    NOTE_LINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NOTE_LINK_RE.exec(body)) !== null) {
        occurrences.push({ targetId: match[1].toLowerCase(), offset: match.index });
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
                section: findSection(lines, lineIndex),
            });
            offsetIndex += 1;
        }

        // +1 accounts for the newline removed by split().
        lineStartOffset = lineEndOffset + 1;
    }

    return contexts;
}
