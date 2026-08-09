import uslug from '@joplin/fork-uslug';
import { offsetToLineIndex, type ParsedMarkdownBody } from './markdownParser';
import { extractRenderedText, HEADING_TEXT_POLICY } from './markdownText';

/** A Markdown heading and its generated anchor/source range. */
export interface MarkdownHeading {
    /** Generated anchor slug, including global duplicate disambiguation. */
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

/** Builds a heading anchor using Joplin's `uslug` fork. */
export function slugifyHeading(text: string): string {
    return uslug(text);
}

function headingLevel(nodeName: string): number | null {
    const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(nodeName);
    return match ? Number(match[1]) : null;
}

/** Extracts rendered ATX and Setext headings from the shared Lezer tree. */
export function parseMarkdownHeadings(parsed: ParsedMarkdownBody): MarkdownHeading[] {
    const headings: MarkdownHeading[] = [];
    const seenSlugs = new Set<string>();

    parsed.tree.iterate({
        enter(cursor) {
            const level = headingLevel(cursor.name);
            if (level === null) {
                return;
            }

            const text = extractRenderedText(parsed, cursor.node, HEADING_TEXT_POLICY).trim();
            const baseSlug = slugifyHeading(text);
            let anchor = baseSlug;
            let counter = 1;
            while (seenSlugs.has(anchor)) {
                counter += 1;
                anchor = `${baseSlug}-${counter}`;
            }
            seenSlugs.add(anchor);

            const startLineIndex = offsetToLineIndex(parsed.lineStarts, cursor.from);
            const endLineIndex = offsetToLineIndex(parsed.lineStarts, Math.max(cursor.from, cursor.to - 1)) + 1;
            let to = cursor.to;
            if (to > cursor.from && parsed.body[to - 1] === '\r') {
                to -= 1;
            }

            headings.push({
                anchor,
                text,
                level,
                startLineIndex,
                endLineIndex,
                from: cursor.from,
                to,
            });
            return false;
        },
    });

    return headings;
}

/** Returns the nearest heading at or above a line. */
export function findSection(headings: readonly MarkdownHeading[], linkLineIndex: number): string {
    for (let index = headings.length - 1; index >= 0; index--) {
        if (headings[index].startLineIndex <= linkLineIndex) {
            return headings[index].text;
        }
    }
    return '';
}

/** Locates the heading named by a case-insensitive anchor. */
export function findHeadingByAnchor(headings: readonly MarkdownHeading[], anchor: string): MarkdownHeading | null {
    const target = anchor.trim().toLowerCase();
    return target ? (headings.find((heading) => heading.anchor === target) ?? null) : null;
}
