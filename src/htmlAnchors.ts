import type { SyntaxNode } from '@lezer/common';
import { decode } from 'html-entities';
import { offsetToLineIndex, type ParsedMarkdownBody } from './markdownParser';
import { extractRenderedText, renderHtmlText, SNIPPET_TEXT_POLICY } from './markdownText';
import { extractSnippetLine, normalizeSnippetText } from './snippetExtraction';

const HTML_OPEN_TAG_RE = /<([a-z][a-z\d-]*)\b[^<>]*>/gi;
const HTML_ANCHOR_ATTRIBUTE_RE = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;

/** An explicit HTML `id` or `name` anchor and its display/navigation context. */
export interface HtmlAnchor {
    id: string;
    text: string;
    snippet: string;
    from: number;
    to: number;
}

function closeTagRe(tagName: string): RegExp {
    return new RegExp(`</${tagName}\\s*>`, 'i');
}

function htmlAnchorId(openingTag: string): string {
    const attribute = HTML_ANCHOR_ATTRIBUTE_RE.exec(openingTag);
    const source = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? '';
    return decode(source, { level: 'html5', scope: 'attribute' }).trim().toLowerCase();
}

function anchorSnippet(parsed: ParsedMarkdownBody, lineIndex: number): string {
    const limit = Math.min(lineIndex + 5, parsed.lines.length);
    for (let index = lineIndex; index < limit; index++) {
        const snippet = extractSnippetLine(parsed, index);
        if (snippet) {
            return snippet;
        }
    }
    return '';
}

function createHtmlAnchor(
    parsed: ParsedMarkdownBody,
    region: string,
    regionStart: number,
    openingTag: string,
    tagName: string,
    from: number,
    id: string,
    structuredContainer?: SyntaxNode
): HtmlAnchor {
    const openingEnd = from + openingTag.length;
    const restOffset = openingEnd - regionStart;
    const rest = maskedHtmlComments(region).slice(restOffset);
    const close = closeTagRe(tagName).exec(rest);
    let to = openingEnd;
    let text = '';

    if (close) {
        const contentTo = openingEnd + close.index;
        to = contentTo + close[0].length;
        const rendered = structuredContainer
            ? extractRenderedText(parsed, structuredContainer, SNIPPET_TEXT_POLICY, openingEnd, contentTo)
            : renderHtmlText(parsed.body.slice(openingEnd, contentTo));
        text = normalizeSnippetText(rendered);
    }

    return {
        id,
        text,
        snippet: anchorSnippet(parsed, offsetToLineIndex(parsed.lineStarts, from)),
        from,
        to,
    };
}

function maskedHtmlComments(value: string): string {
    return value.replace(HTML_COMMENT_RE, (comment) => ' '.repeat(comment.length));
}

/** Parses explicit HTML anchors only inside Lezer-recognized HTML regions. */
export function parseHtmlAnchors(parsed: ParsedMarkdownBody): HtmlAnchor[] {
    const anchors: HtmlAnchor[] = [];
    const seenOffsets = new Set<number>();

    parsed.tree.iterate({
        enter(cursor) {
            if (cursor.name === 'HTMLTag') {
                const openingTag = parsed.body.slice(cursor.from, cursor.to);
                HTML_OPEN_TAG_RE.lastIndex = 0;
                const match = HTML_OPEN_TAG_RE.exec(openingTag);
                const id = match?.index === 0 ? htmlAnchorId(openingTag) : '';
                if (!match || !id || seenOffsets.has(cursor.from)) {
                    return false;
                }

                const container = cursor.node.parent ?? cursor.node;
                const regionStart = container.from;
                const region = parsed.body.slice(regionStart, container.to);
                seenOffsets.add(cursor.from);
                anchors.push(
                    createHtmlAnchor(parsed, region, regionStart, openingTag, match[1], cursor.from, id, container)
                );
                return false;
            }

            if (cursor.name !== 'HTMLBlock') {
                return;
            }

            const regionStart = cursor.from;
            const region = parsed.body.slice(cursor.from, cursor.to);
            const scanText = maskedHtmlComments(region);
            HTML_OPEN_TAG_RE.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = HTML_OPEN_TAG_RE.exec(scanText)) !== null) {
                const id = htmlAnchorId(match[0]);
                const from = regionStart + match.index;
                if (!id || seenOffsets.has(from)) {
                    continue;
                }
                seenOffsets.add(from);
                anchors.push(createHtmlAnchor(parsed, region, regionStart, match[0], match[1], from, id));
            }
            return false;
        },
    });

    anchors.sort((left, right) => left.from - right.from);
    return anchors;
}

/** Locates the first HTML anchor matching a case-insensitive fragment. */
export function findHtmlAnchorById(anchors: readonly HtmlAnchor[], anchorId: string): HtmlAnchor | null {
    const target = anchorId.trim().toLowerCase();
    return target ? (anchors.find((anchor) => anchor.id === target) ?? null) : null;
}
