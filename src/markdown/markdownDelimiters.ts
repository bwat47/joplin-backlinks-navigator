import type { InlineContext, MarkdownConfig } from '@lezer/markdown';

/** Matches one punctuation or symbol character, as CommonMark's flanking rules define it. */
const PUNCTUATION_RE = /[\p{P}\p{S}]/u;

/**
 * Builds an inline extension for a doubled delimiter pair such as `==text==`, reusing the flanking
 * rules `@lezer/markdown` applies to `~~`. The delimiter node is named `<name>Mark` so rendered-text
 * extraction drops it alongside every other Markdown mark.
 */
function doubledDelimiter(name: string, delimiter: string): MarkdownConfig {
    const markName = `${name}Mark`;
    const delimiterType = { resolve: name, mark: markName };
    const code = delimiter.charCodeAt(0);

    return {
        defineNodes: [name, markName],
        parseInline: [
            {
                name,
                parse(cx: InlineContext, next: number, pos: number): number {
                    if (next !== code || cx.char(pos + 1) !== code || cx.char(pos + 2) === code) {
                        return -1;
                    }
                    const before = cx.slice(pos - 1, pos);
                    const after = cx.slice(pos + 2, pos + 3);
                    const spaceBefore = /\s|^$/.test(before);
                    const spaceAfter = /\s|^$/.test(after);
                    const punctuationBefore = PUNCTUATION_RE.test(before);
                    const punctuationAfter = PUNCTUATION_RE.test(after);
                    return cx.addDelimiter(
                        delimiterType,
                        pos,
                        pos + 2,
                        !spaceAfter && (!punctuationAfter || spaceBefore || punctuationBefore),
                        !spaceBefore && (!punctuationBefore || spaceAfter || punctuationAfter)
                    );
                },
                after: 'Emphasis',
            },
        ],
    };
}

/** `==highlight==`, matching Joplin's `markdown-it-mark` plugin. */
export const Highlight = doubledDelimiter('Highlight', '=');

/** `++insert++`, matching Joplin's `markdown-it-ins` plugin. */
export const Insert = doubledDelimiter('Insert', '+');
