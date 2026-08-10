import type { Tree } from '@lezer/common';
import { parser, Strikethrough, Table, TaskList } from '@lezer/markdown';
import { Highlight, Insert } from './markdownDelimiters';

// Keep the standalone grammar explicit. The full GFM bundle also enables bare-URL autolinking,
// which is not part of the Markdown behavior this plugin needs to model. Highlight and Insert are
// not Lezer built-ins; they cover the `==`/`++` syntax Joplin's renderer enables.
const markdownSyntaxParser = parser.configure([Table, TaskList, Strikethrough, Highlight, Insert]);

/** Markdown source and the shared structures derived from one parse. */
export interface ParsedMarkdownBody {
    readonly body: string;
    readonly tree: Tree;
    readonly lineStarts: readonly number[];
    readonly lines: readonly string[];
}

/** Parses a body once with Lezer and prepares shared line indexes. */
export function parseMarkdownBody(body: string): ParsedMarkdownBody {
    const lines = body.split('\n');
    const lineStarts = [0];
    for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex++) {
        lineStarts.push(lineStarts[lineIndex] + lines[lineIndex].length + 1);
    }

    return {
        body,
        tree: markdownSyntaxParser.parse(body),
        lineStarts,
        lines,
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
