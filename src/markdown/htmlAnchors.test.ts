import { findHtmlAnchorById, parseHtmlAnchors } from './htmlAnchors';
import { parseMarkdownBody } from './markdownParser';

describe('Lezer HTML anchor extraction', () => {
    it('decodes HTML entities in id and name attributes', () => {
        const anchors = parseHtmlAnchors(
            parseMarkdownBody('<a id="A&amp;B">first</a> <span name="C&#x2D;D">second</span>')
        );

        expect(anchors.map(({ id, text }) => ({ id, text }))).toEqual([
            { id: 'a&b', text: 'first' },
            { id: 'c-d', text: 'second' },
        ]);
        expect(findHtmlAnchorById(anchors, ' A&B ')?.text).toBe('first');
    });

    it('ignores anchor-looking tags inside block and inline HTML comments', () => {
        const body =
            '<!-- <a id="block-comment">no</a> -->\n\n' +
            'Text <!-- <span id="inline-comment">no</span> --> after.\n\n' +
            '<a id="real">yes</a>';

        expect(parseHtmlAnchors(parseMarkdownBody(body)).map(({ id }) => id)).toEqual(['real']);
    });

    it('does not treat a closing tag inside a comment as the anchor boundary', () => {
        const body = '<a id="real">before<!-- </a> -->after</a>';
        const [anchor] = parseHtmlAnchors(parseMarkdownBody(body));

        expect(anchor).toMatchObject({ id: 'real', text: 'beforeafter', from: 0, to: body.length });
    });

    it('extracts rendered text from formatted inline anchor contents', () => {
        const [anchor] = parseHtmlAnchors(parseMarkdownBody('<a id="formatted">Visible **bold** &amp; `code`</a>'));

        expect(anchor.text).toBe('Visible bold & code');
        expect(anchor.snippet).toBe('Visible bold & code');
    });
});
