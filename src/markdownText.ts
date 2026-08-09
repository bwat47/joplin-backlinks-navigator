import type { SyntaxNode } from '@lezer/common';
import { decode } from 'html-entities';
import type { ParsedMarkdownBody } from './markdownParser';

const MARKDOWN_ESCAPE_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
const MARKDOWN_ENTITY_RE = /&(?:[a-z][a-z\d]{1,31}|#(?:x[a-f\d]{1,8}|\d{1,8}));/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

const SKIPPED_RENDERED_NODE_NAMES = new Set([
    'Comment',
    'HTMLTag',
    'HardBreak',
    'LinkLabel',
    'LinkTitle',
    'TableDelimiter',
    'TaskMarker',
]);
const SKIPPED_BLOCK_NODE_NAMES = new Set([
    'CommentBlock',
    'FencedCode',
    'HorizontalRule',
    'IndentedCode',
    'LinkReference',
    'ProcessingInstructionBlock',
]);
const referenceLabelCache = new WeakMap<ParsedMarkdownBody, ReadonlySet<string>>();

export interface MarkdownTextPolicy {
    readonly includeImageAlt: boolean;
    readonly skipBlockNodes: boolean;
}

export const HEADING_TEXT_POLICY: MarkdownTextPolicy = {
    includeImageAlt: false,
    skipBlockNodes: false,
};

export const SNIPPET_TEXT_POLICY: MarkdownTextPolicy = {
    includeImageAlt: true,
    skipBlockNodes: true,
};

function isValidEntityCode(codePoint: number): boolean {
    return !(
        codePoint <= 0x08 ||
        codePoint === 0x0b ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
        (codePoint & 0xffff) === 0xffff ||
        (codePoint & 0xffff) === 0xfffe ||
        codePoint > 0x10ffff
    );
}

/** Decodes one CommonMark entity while preserving invalid numeric references. */
function decodeMarkdownEntity(entity: string): string {
    if (entity.startsWith('&#')) {
        const hexadecimal = entity[2]?.toLowerCase() === 'x';
        const digits = entity.slice(hexadecimal ? 3 : 2, -1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (!isValidEntityCode(codePoint)) {
            return entity;
        }
    }
    return decode(entity, { level: 'html5', scope: 'strict' });
}

/** Applies CommonMark backslash and entity unescaping to source text. */
export function unescapeMarkdownText(value: string): string {
    return value.replace(MARKDOWN_ESCAPE_RE, '$1').replace(MARKDOWN_ENTITY_RE, decodeMarkdownEntity);
}

/** Removes HTML tags/comments, repeating until malformed nesting can no longer expose a new tag. */
export function stripHtmlTags(value: string): string {
    let current = value.replace(HTML_COMMENT_RE, '');
    let previous: string;
    do {
        previous = current;
        current = current.replace(HTML_TAG_RE, '');
    } while (current !== previous);
    return current;
}

/** Removes HTML markup and decodes the text content it would render. */
export function renderHtmlText(value: string): string {
    return decode(stripHtmlTags(value), { level: 'html5', scope: 'body' });
}

function clippedSlice(body: string, from: number, to: number, rangeFrom: number, rangeTo: number): string {
    return body.slice(Math.max(from, rangeFrom), Math.min(to, rangeTo));
}

/** Applies CommonMark's whitespace collapse and Unicode case-folding approximation. */
export function normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase();
}

function primaryLabel(parsed: ParsedMarkdownBody, node: SyntaxNode): string {
    const marks = node.getChildren('LinkMark');
    return marks.length >= 2 ? extractLogicalSource(parsed, node, marks[0].to, marks[1].from) : '';
}

/** Resolves the normalized label used by a full, collapsed, or shortcut reference. */
export function extractReferenceLabel(parsed: ParsedMarkdownBody, node: SyntaxNode): string {
    const explicitLabel = node.getChild('LinkLabel');
    const explicitText = explicitLabel
        ? extractLogicalSource(parsed, explicitLabel, explicitLabel.from + 1, explicitLabel.to - 1)
        : '';
    return normalizeReferenceLabel(explicitText || primaryLabel(parsed, node));
}

function definedReferenceLabels(parsed: ParsedMarkdownBody): ReadonlySet<string> {
    const cached = referenceLabelCache.get(parsed);
    if (cached) {
        return cached;
    }

    const labels = new Set<string>();
    parsed.tree.iterate({
        enter(cursor) {
            if (cursor.name !== 'LinkReference') {
                return;
            }
            const labelNode = cursor.node.getChild('LinkLabel');
            if (labelNode) {
                labels.add(
                    normalizeReferenceLabel(
                        extractLogicalSource(parsed, labelNode, labelNode.from + 1, labelNode.to - 1)
                    )
                );
            }
            return false;
        },
    });
    referenceLabelCache.set(parsed, labels);
    return labels;
}

function isUnresolvedReference(parsed: ParsedMarkdownBody, node: SyntaxNode): boolean {
    const isReference = node.getChild('LinkLabel') !== null || node.getChildren('LinkMark').length === 2;
    return (
        (node.name === 'Link' || node.name === 'Image') &&
        isReference &&
        !node.getChild('URL') &&
        !definedReferenceLabels(parsed).has(extractReferenceLabel(parsed, node))
    );
}

function extractRenderedChild(
    parsed: ParsedMarkdownBody,
    node: SyntaxNode,
    policy: MarkdownTextPolicy,
    rangeFrom: number,
    rangeTo: number
): string {
    if (node.name.endsWith('Mark') || SKIPPED_RENDERED_NODE_NAMES.has(node.name)) {
        return '';
    }
    if (node.name === 'Entity') {
        return unescapeMarkdownText(clippedSlice(parsed.body, node.from, node.to, rangeFrom, rangeTo));
    }
    if (node.name === 'Escape') {
        const source = clippedSlice(parsed.body, node.from, node.to, rangeFrom, rangeTo);
        return source.startsWith('\\') ? source.slice(1) : source;
    }
    if (node.name === 'URL' && (node.parent?.name === 'Link' || node.parent?.name === 'Image')) {
        return '';
    }

    return extractRenderedText(parsed, node, policy, rangeFrom, rangeTo);
}

/** Extracts visible Markdown text from a node, optionally clipped to a source range. */
export function extractRenderedText(
    parsed: ParsedMarkdownBody,
    node: SyntaxNode,
    policy: MarkdownTextPolicy,
    rangeFrom: number = node.from,
    rangeTo: number = node.to
): string {
    const from = Math.max(node.from, rangeFrom);
    const to = Math.min(node.to, rangeTo);
    if (from >= to) {
        return '';
    }
    if (policy.skipBlockNodes && SKIPPED_BLOCK_NODE_NAMES.has(node.name)) {
        return '';
    }
    if (node.name === 'Image' && !policy.includeImageAlt) {
        return '';
    }
    if (isUnresolvedReference(parsed, node)) {
        return clippedSlice(parsed.body, node.from, node.to, from, to);
    }
    if (node.name === 'HTMLBlock') {
        return renderHtmlText(clippedSlice(parsed.body, node.from, node.to, from, to));
    }

    const cursor = node.cursor();
    if (!cursor.firstChild()) {
        return clippedSlice(parsed.body, node.from, node.to, rangeFrom, rangeTo);
    }

    let output = '';
    let position = from;
    do {
        if (cursor.to <= from || cursor.from >= to) {
            continue;
        }
        if (cursor.from > position) {
            output += parsed.body.slice(position, Math.min(cursor.from, to));
        }
        output += extractRenderedChild(parsed, cursor.node, policy, from, to);
        position = Math.max(position, Math.min(cursor.to, to));
    } while (cursor.nextSibling());

    if (position < to) {
        output += parsed.body.slice(position, to);
    }
    return output;
}

/** Extracts logical label source while removing Markdown container prefixes. */
export function extractLogicalSource(
    parsed: ParsedMarkdownBody,
    node: SyntaxNode,
    rangeFrom: number,
    rangeTo: number
): string {
    const from = Math.max(node.from, rangeFrom);
    const to = Math.min(node.to, rangeTo);
    if (from >= to) {
        return '';
    }

    const cursor = node.cursor();
    if (!cursor.firstChild()) {
        return parsed.body.slice(from, to);
    }

    let output = '';
    let position = from;
    do {
        if (cursor.to <= from || cursor.from >= to) {
            continue;
        }
        if (cursor.from > position) {
            output += parsed.body.slice(position, Math.min(cursor.from, to));
        }
        if (cursor.name !== 'QuoteMark') {
            output += extractLogicalSource(parsed, cursor.node, from, to);
        }
        position = Math.max(position, Math.min(cursor.to, to));
    } while (cursor.nextSibling());

    if (position < to) {
        output += parsed.body.slice(position, to);
    }
    return output;
}
