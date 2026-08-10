import { parseHtmlAnchors } from './htmlAnchors';
import { extractNoteLinks } from './linkExtraction';
import { parseMarkdownHeadings } from './markdownHeadings';
import { parseMarkdownBody } from './markdownParser';
import { extractNoteOpening, extractOccurrenceContexts, extractSectionOpening } from './snippetExtraction';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('Markdown extraction golden behavior', () => {
    it('keeps rendered link recognition, destinations, and ranges stable', () => {
        const body =
            `# Links\n[Inline](:/${ID_A}#One) [Angle](<:/${ID_B}#Two%20Words>)\n` +
            `[Ref][target] [target][] [target]\n\n[target]: :/${ID_A}#Referenced "Title"`;

        const parsed = parseMarkdownBody(body);
        expect(extractNoteLinks(parsed)).toEqual([
            { targetId: ID_A, anchor: 'one', from: 8, to: 56 },
            { targetId: ID_B, anchor: 'two words', from: 57, to: 114 },
            { targetId: ID_A, anchor: 'referenced', from: 115, to: 128 },
            { targetId: ID_A, anchor: 'referenced', from: 129, to: 139 },
            { targetId: ID_A, anchor: 'referenced', from: 140, to: 148 },
        ]);

        expect(
            extractOccurrenceContexts(
                parsed,
                extractNoteLinks(parsed).map(({ from }) => from)
            )
        ).toEqual([
            { snippet: 'Inline Angle', section: 'Links' },
            { snippet: 'Inline Angle', section: 'Links' },
            { snippet: 'Ref target target', section: 'Links' },
            { snippet: 'Ref target target', section: 'Links' },
            { snippet: 'Ref target target', section: 'Links' },
        ]);
    });

    it('keeps formatted heading text, CRLF ranges, and global slug collisions stable', () => {
        const body =
            '## A &amp; *bold* [link](https://example.com) `code` ![image](x) <em>HTML</em> ✅ 日本語\r\n' +
            '\r\nSetext *Heading*\r\n---\r\n\r\n## !!!\r\n\r\n## ???\r\n\r\n## -2\r\n\r\n## !!!';

        expect(parseMarkdownHeadings(parseMarkdownBody(body))).toEqual([
            {
                anchor: 'a-bold-link-code-html-white_check_mark-日本語',
                text: 'A & bold link code  HTML ✅ 日本語',
                level: 2,
                startLineIndex: 0,
                endLineIndex: 1,
                from: 0,
                to: 84,
            },
            {
                anchor: 'setext-heading',
                text: 'Setext Heading',
                level: 2,
                startLineIndex: 2,
                endLineIndex: 4,
                from: 88,
                to: 109,
            },
            { anchor: '', text: '!!!', level: 2, startLineIndex: 5, endLineIndex: 6, from: 113, to: 119 },
            { anchor: '-2', text: '???', level: 2, startLineIndex: 7, endLineIndex: 8, from: 123, to: 129 },
            { anchor: '-2-2', text: '-2', level: 2, startLineIndex: 9, endLineIndex: 10, from: 133, to: 138 },
            { anchor: '-3', text: '!!!', level: 2, startLineIndex: 11, endLineIndex: 12, from: 142, to: 148 },
        ]);
    });

    it('keeps HTML anchor labels, previews, and exact ranges stable', () => {
        const body =
            'Intro.\n\n<span data-id="skip"><a ID="Top">Visible <em>label</em></a></span>\n\n' +
            '| Term |\n| --- |\n| <span name=Cell>Cell text</span> |\n\n' +
            '```html\n<a id="code">no</a>\n```';

        expect(parseHtmlAnchors(parseMarkdownBody(body))).toEqual([
            { id: 'top', text: 'Visible label', snippet: 'Visible label', from: 29, to: 67 },
            { id: 'cell', text: 'Cell text', snippet: 'Cell text', from: 95, to: 127 },
        ]);
    });

    it('keeps opening and empty-section fallback behavior stable', () => {
        const opening = parseMarkdownBody(
            '# Title\n\n> [!NOTE]\n> - [x] Read **this** [guide](https://example.com) and ![diagram](x.png).'
        );
        expect(extractNoteOpening(opening)).toBe('Read this guide and diagram.');

        const headingOnly = parseMarkdownBody('---\n\n## Only heading');
        expect(extractNoteOpening(headingOnly)).toBe('Only heading');

        const emptySection = parseMarkdownBody('## Setup\n\n## Next\nText');
        const headings = parseMarkdownHeadings(emptySection);
        expect(extractSectionOpening(emptySection, headings[0].endLineIndex, headings[1].startLineIndex)).toBe('');
    });
});
