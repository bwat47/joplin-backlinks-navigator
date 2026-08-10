import type { SyntaxNode } from '@lezer/common';
import { findSection, parseMarkdownHeadings, type MarkdownHeading } from './markdownHeadings';
import { offsetToLineIndex, type ParsedMarkdownBody } from './markdownParser';
import { extractRenderedText, SNIPPET_TEXT_POLICY, stripHtmlTags } from './markdownText';

const SNIPPET_MAX_LENGTH = 120;
/**
 * Matches a leading GitHub/Obsidian alert marker on an already-rendered line, e.g. "[!NOTE]",
 * "[!warning]-", "[!tip]+ Title". Unresolved shortcut references keep their brackets in rendered
 * text, so the marker is still bracketed here; an unbracketed `!word` is ordinary prose.
 */
const ALERT_MARKER_RE = /^\[!\w+\][+-]?\s*/;

/** Collapses and truncates already-rendered text for display in a link row. */
export function normalizeSnippetText(value: string): string {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= SNIPPET_MAX_LENGTH) {
        return cleaned;
    }
    return `${cleaned.slice(0, SNIPPET_MAX_LENGTH - 1)}…`;
}

function lineContainer(parsed: ParsedMarkdownBody, lineIndex: number): SyntaxNode {
    const line = parsed.lines[lineIndex] ?? '';
    const lineStart = parsed.lineStarts[lineIndex] ?? parsed.body.length;
    const firstContent = line.search(/\S/);
    const probe = firstContent === -1 ? lineStart : Math.min(lineStart + firstContent, parsed.body.length);
    let node = parsed.tree.resolveInner(probe, 1);

    while (node.parent && node.parent.name !== 'Document') {
        node = node.parent;
    }
    return node;
}

/** Extracts rendered prose from one source line using its enclosing Lezer block. */
export function extractSnippetLine(parsed: ParsedMarkdownBody, lineIndex: number): string {
    const line = parsed.lines[lineIndex];
    if (line === undefined || !line.trim()) {
        return '';
    }

    const lineStart = parsed.lineStarts[lineIndex] ?? parsed.body.length;
    let lineEnd = lineStart + line.length;
    if (lineEnd > lineStart && parsed.body[lineEnd - 1] === '\r') {
        lineEnd -= 1;
    }
    const rendered = extractRenderedText(
        parsed,
        lineContainer(parsed, lineIndex),
        SNIPPET_TEXT_POLICY,
        lineStart,
        lineEnd
    );
    return normalizeSnippetText(stripHtmlTags(rendered)).replace(ALERT_MARKER_RE, '').trim();
}

function extractOpening(
    parsed: ParsedMarkdownBody,
    startLineIndex: number,
    endLineIndex: number,
    headings: readonly MarkdownHeading[]
): string {
    const headingsByStartLine = new Map(headings.map((heading) => [heading.startLineIndex, heading]));
    let headingFallback = '';
    let lineIndex = startLineIndex;

    while (lineIndex < Math.min(endLineIndex, parsed.lines.length)) {
        const heading = headingsByStartLine.get(lineIndex);
        if (heading) {
            headingFallback ||= heading.text;
            lineIndex = heading.endLineIndex;
            continue;
        }

        const snippet = extractSnippetLine(parsed, lineIndex);
        if (snippet) {
            return snippet;
        }
        lineIndex += 1;
    }
    return headingFallback;
}

/** Builds a rendered-text preview from the beginning of a note. */
export function extractNoteOpening(
    parsed: ParsedMarkdownBody,
    headings: readonly MarkdownHeading[] = parseMarkdownHeadings(parsed)
): string {
    return extractOpening(parsed, 0, parsed.lines.length, headings);
}

/** Builds a rendered-text preview without crossing the supplied section boundary. */
export function extractSectionOpening(
    parsed: ParsedMarkdownBody,
    startLineIndex: number,
    endLineIndex: number
): string {
    return extractOpening(parsed, startLineIndex, endLineIndex, []);
}

/** Display context for a single rendered link occurrence. */
export interface OccurrenceContext {
    snippet: string;
    section: string;
}

/** Resolves the rendered line preview and enclosing heading for each source offset. */
export function extractOccurrenceContexts(parsed: ParsedMarkdownBody, offsets: readonly number[]): OccurrenceContext[] {
    if (!offsets.length) {
        return [];
    }

    const headings = parseMarkdownHeadings(parsed);
    return offsets.map((offset) => {
        const lineIndex = offsetToLineIndex(parsed.lineStarts, offset);
        return {
            snippet: extractSnippetLine(parsed, lineIndex),
            section: findSection(headings, lineIndex),
        };
    });
}
