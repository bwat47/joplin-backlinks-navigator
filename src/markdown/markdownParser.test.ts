import { parseMarkdownBody } from './markdownParser';

describe('parseMarkdownBody', () => {
    it('builds one Lezer tree and aligned LF/CRLF line indexes without renderer tokens', () => {
        const body = '# One\r\n\r\nTwo';
        const parsed = parseMarkdownBody(body);

        expect(parsed.body).toBe(body);
        expect(parsed.tree.length).toBe(body.length);
        expect(parsed.lines).toEqual(['# One\r', '\r', 'Two']);
        expect(parsed.lineStarts).toEqual([0, 7, 9]);
        expect(Object.keys(parsed).sort()).toEqual(['body', 'lineStarts', 'lines', 'tree']);
    });
});
