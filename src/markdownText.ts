import type { SyntaxNode } from '@lezer/common';
import { decode } from 'html-entities';
import type { ParsedMarkdownBody } from './markdownParser';

const MARKDOWN_ESCAPE_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
const MARKDOWN_ENTITY_RE = /&(?:[a-z][a-z\d]{1,31}|#(?:x[a-f\d]{1,8}|\d{1,8}));/gi;

const SKIPPED_RENDERED_NODE_NAMES = new Set(['HTMLTag', 'LinkLabel', 'LinkTitle', 'TableDelimiter', 'TaskMarker']);
const SKIPPED_BLOCK_NODE_NAMES = new Set(['FencedCode', 'IndentedCode', 'LinkReference', 'HorizontalRule']);

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

function clippedSlice(body: string, from: number, to: number, rangeFrom: number, rangeTo: number): string {
    return body.slice(Math.max(from, rangeFrom), Math.min(to, rangeTo));
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
    if (policy.skipBlockNodes && SKIPPED_BLOCK_NODE_NAMES.has(node.name)) {
        return '';
    }
    if (node.name === 'Image' && !policy.includeImageAlt) {
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
