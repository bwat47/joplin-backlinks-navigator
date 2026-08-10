import { parseMarkdownBody } from './markdownParser';
import { extractNoteOpening, extractSnippetLine } from './snippetExtraction';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('tree-based snippet extraction', () => {
    it('returns rendered text for supported inline Markdown', () => {
        const parsed = parseMarkdownBody(
            `- [x] **Bold** ~~gone~~ [Link](:/${ID}) ![Alt](image.png) \\*literal\\* \`code\` &amp; <em>HTML</em>`
        );

        expect(extractSnippetLine(parsed, 0)).toBe('Bold gone Link Alt *literal* code & HTML');
    });

    it('strips highlight and insert delimiters while leaving unpaired ones intact', () => {
        const parsed = parseMarkdownBody('==marked== ++inserted++ 2 == 2 and c++ ++');

        expect(extractSnippetLine(parsed, 0)).toBe('marked inserted 2 == 2 and c++ ++');
    });

    it('strips subscript and superscript markers without disturbing strikethrough', () => {
        const parsed = parseMarkdownBody('H~2~O x^2^ ~~gone~~ a ~ b');

        expect(extractSnippetLine(parsed, 0)).toBe('H2O x2 gone a ~ b');
    });

    it('renders valid references and preserves unresolved reference syntax', () => {
        const parsed = parseMarkdownBody(`[Valid][target] [target][] [target] [Missing][unknown]\n\n[target]: :/${ID}`);

        expect(extractSnippetLine(parsed, 0)).toBe('Valid target target [Missing][unknown]');
    });

    it('renders inline links with empty destinations as links', () => {
        const parsed = parseMarkdownBody('[empty]() and ![image]()');

        expect(extractNoteOpening(parsed)).toBe('empty and image');
    });

    it('skips code blocks and reference definitions when finding note prose', () => {
        const parsed = parseMarkdownBody(`\`\`\`md\nexample\n\`\`\`\n\n[target]: :/${ID}\n\nActual **opening**.`);

        expect(extractNoteOpening(parsed)).toBe('Actual opening.');
    });

    it('extracts visible prose from an HTML block', () => {
        const parsed = parseMarkdownBody('<div>\n<strong>Visible</strong> &amp; readable\n</div>');

        expect(extractNoteOpening(parsed)).toBe('Visible & readable');
    });

    it('drops a bracketed alert marker without touching prose that opens with "!word"', () => {
        expect(extractNoteOpening(parseMarkdownBody('> [!warning]- Collapsed title'))).toBe('Collapsed title');
        expect(extractNoteOpening(parseMarkdownBody('!important do this'))).toBe('!important do this');
    });

    it('renders any line of a large block without depending on its position', () => {
        const items = Array.from({ length: 400 }, (_, i) => `- item ${i} with **bold** [Link](:/${ID})`);
        const parsed = parseMarkdownBody(items.join('\n'));

        for (const index of [0, 1, 200, 398, 399]) {
            expect(extractSnippetLine(parsed, index)).toBe(`item ${index} with bold Link`);
        }
    });

    it('renders any row of a large table without depending on its position', () => {
        const rows = ['| Head |', '| --- |', ...Array.from({ length: 400 }, (_, i) => `| cell ${i} |`)];
        const parsed = parseMarkdownBody(rows.join('\n'));

        expect(extractSnippetLine(parsed, 2)).toBe('cell 0');
        expect(extractSnippetLine(parsed, 401)).toBe('cell 399');
    });

    it('omits inline comments and hard-break syntax', () => {
        const parsed = parseMarkdownBody('Visible <!-- hidden --> text  \nnext');

        expect(extractSnippetLine(parsed, 0)).toBe('Visible text');
    });
});
