/**
 * Heading-anchor resolution using MarkdownIt and Joplin's fork of `uslug` for slug generation.
 *
 * Parsing rather than approximating Markdown with regular expressions keeps Setext headings,
 * inline markup, entities, HTML, and globally unique duplicate slugs aligned with rendered anchor
 * ids. The generated HTML is never rendered; only the parsed heading tokens are inspected.
 */

import uslug from '@joplin/fork-uslug';
import MarkdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import type Token from 'markdown-it/lib/token.mjs';

const markdown = new MarkdownIt({ html: true }).use(markdownItAnchor, { slugify: uslug });

/** A rendered heading anchor and its range in the original Markdown source. */
export interface HeadingAnchor {
    /** Anchor id, without the leading `#`. */
    anchor: string;
    /** Rendered text used to generate the anchor. */
    text: string;
    /** Heading level, from 1 through 6. */
    level: number;
    /** Zero-based index of the heading's first source line. */
    lineIndex: number;
    /** Zero-based exclusive index after the heading's final source line. */
    endLineIndex: number;
    /** Offset of the heading's first source character. */
    from: number;
    /** Offset after the heading's final source character. */
    to: number;
}

function lineStartOffsets(body: string): number[] {
    const offsets = [0];
    for (let offset = 0; offset < body.length; offset++) {
        if (body.charCodeAt(offset) === 10) {
            offsets.push(offset + 1);
        }
    }
    return offsets;
}

function lineEndOffset(body: string, starts: readonly number[], lineIndex: number): number {
    const nextLineStart = starts[lineIndex + 1];
    let end = nextLineStart === undefined ? body.length : nextLineStart - 1;
    // Exclude the carriage return in CRLF documents from the highlighted range.
    if (end > 0 && body.charCodeAt(end - 1) === 13) {
        end -= 1;
    }
    return end;
}

function renderedHeadingText(inlineToken: Token): string {
    return (inlineToken.children ?? [])
        .filter((child) => child.type === 'text' || child.type === 'code_inline')
        .map((child) => child.content)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts every rendered heading anchor in document order.
 *
 * `markdown-it-anchor` mutates each `heading_open` token to add its globally unique `id`. The
 * token's source map then provides the original line range needed for editor scrolling.
 */
export function extractHeadingAnchors(body: string): HeadingAnchor[] {
    const tokens = markdown.parse(body, {});
    const starts = lineStartOffsets(body);
    const headings: HeadingAnchor[] = [];

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.type !== 'heading_open' || !token.map) {
            continue;
        }

        const inlineToken = tokens[index + 1];
        const anchor = token.attrGet('id');
        if (!inlineToken || inlineToken.type !== 'inline' || anchor === null) {
            continue;
        }

        const [lineIndex, rawEndLineIndex] = token.map;
        const endLineIndex = Math.min(rawEndLineIndex, starts.length);
        const finalLineIndex = Math.max(lineIndex, endLineIndex - 1);
        headings.push({
            anchor,
            text: renderedHeadingText(inlineToken),
            level: Number(token.tag.slice(1)),
            lineIndex,
            endLineIndex,
            from: starts[lineIndex] ?? body.length,
            to: lineEndOffset(body, starts, finalLineIndex),
        });
    }

    return headings;
}

/** Finds the parsed heading named by `anchor`, ignoring surrounding whitespace and letter case. */
export function findHeadingByAnchor(headings: readonly HeadingAnchor[], anchor: string): HeadingAnchor | null {
    const target = anchor.trim().toLowerCase();
    if (!target) {
        return null;
    }
    return headings.find((heading) => heading.anchor.toLowerCase() === target) ?? null;
}
