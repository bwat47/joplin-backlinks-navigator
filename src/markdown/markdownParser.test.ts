import { describe, it, expect } from 'vitest';
import { parseMarkdownBody } from './markdownParser';

describe('parseMarkdownBody', () => {
    it('normalizes CRLF and lone CR line breaks before building the tree and line indexes', () => {
        const parsed = parseMarkdownBody('# One\r\n\r\nTwo\rThree');
        const body = '# One\n\nTwo\nThree';

        expect(parsed.body).toBe(body);
        expect(parsed.tree).toHaveLength(body.length);
        expect(parsed.lines).toEqual(['# One', '', 'Two', 'Three']);
        expect(parsed.lineStarts).toEqual([0, 6, 7, 11]);
        expect(new Set(Object.keys(parsed))).toEqual(new Set(['body', 'lineStarts', 'lines', 'tree']));
    });
});
