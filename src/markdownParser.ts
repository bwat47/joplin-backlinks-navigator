import type { Tree } from '@lezer/common';
import { parser, Strikethrough, Table, TaskList } from '@lezer/markdown';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

// Keep the standalone grammar explicit. The full GFM bundle also enables bare-URL autolinking,
// which is not part of the Markdown behavior this plugin needs to model.
const markdownSyntaxParser = parser.configure([Table, TaskList, Strikethrough]);

// HTML-anchor discovery still uses these tokens until its dedicated Lezer migration.
const legacyMarkdownParser = new MarkdownIt({ html: true });

/** Markdown source and the shared structures derived from one parse. */
export interface ParsedMarkdownBody {
    readonly body: string;
    readonly tree: Tree;
    readonly lineStarts: readonly number[];
    readonly lines: readonly string[];
    /** Lazily supplies legacy tokens only while HTML-anchor extraction still needs them. */
    readonly getLegacyTokens: () => readonly Token[];
}

/** Parses a body once with Lezer and prepares shared line indexes. */
export function parseMarkdownBody(body: string): ParsedMarkdownBody {
    const lines = body.split('\n');
    const lineStarts = [0];
    for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex++) {
        lineStarts.push(lineStarts[lineIndex] + lines[lineIndex].length + 1);
    }

    let legacyTokens: readonly Token[] | undefined;
    return {
        body,
        tree: markdownSyntaxParser.parse(body),
        lineStarts,
        lines,
        getLegacyTokens: () => (legacyTokens ??= legacyMarkdownParser.parse(body, {})),
    };
}

/** Returns the zero-based line containing an offset. */
export function offsetToLineIndex(lineStarts: readonly number[], offset: number): number {
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
