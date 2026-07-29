import MarkdownIt from 'markdown-it';
import {
    cleanSnippetLine,
    extractNoteLinks,
    extractNoteOpening,
    extractOccurrenceContexts,
    extractSectionOpening,
    findHeadingByAnchor,
    findHtmlAnchorById,
    findOccurrenceOffsets,
    findSection,
    linkNeedle,
    parseHtmlAnchors,
    parseMarkdownBody,
    parseMarkdownHeadings,
    slugifyHeading,
} from './linkExtraction';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('parseMarkdownBody', () => {
    it('shares one markdown-it parse across heading and HTML-anchor extraction', () => {
        const parseSpy = vi.spyOn(MarkdownIt.prototype, 'parse');
        try {
            const parsed = parseMarkdownBody('# Heading\n\n<a id="target">Target</a>');

            expect(parseMarkdownHeadings(parsed)).toHaveLength(1);
            expect(parseHtmlAnchors(parsed)).toHaveLength(1);
            expect(parseSpy).toHaveBeenCalledTimes(1);
        } finally {
            parseSpy.mockRestore();
        }
    });
});

describe('linkNeedle', () => {
    it('prefixes the note id with the internal link scheme', () => {
        expect(linkNeedle(ID_A)).toBe(`:/${ID_A}`);
    });
});

describe('cleanSnippetLine', () => {
    it('unwraps links/images and strips leading block markers', () => {
        expect(cleanSnippetLine(`- [ ] see [Target](:/${ID_A}) and ![pic](:/res)`)).toBe('see Target and pic');
        expect(cleanSnippetLine('> ## Quoted heading')).toBe('Quoted heading');
    });

    it('truncates very long lines', () => {
        const long = 'x'.repeat(200);
        const result = cleanSnippetLine(long);
        expect(result.endsWith('…')).toBe(true);
        expect(result.length).toBe(120);
    });
});

describe('findSection', () => {
    it('returns the nearest heading above the line', () => {
        const body = '# Top\nintro\n\nSub\n---\nbody';
        const headings = parseMarkdownHeadings(parseMarkdownBody(body));
        expect(findSection(headings, 5)).toBe('Sub');
        expect(findSection(headings, 1)).toBe('Top');
    });

    it('returns empty string when there is no heading above', () => {
        expect(findSection(parseMarkdownHeadings(parseMarkdownBody('just text\nmore')), 1)).toBe('');
    });
});

describe('extractNoteOpening', () => {
    it('returns the first line of prose, skipping a leading heading', () => {
        expect(extractNoteOpening(parseMarkdownBody('# Title\n\nFirst paragraph of the note.'))).toBe(
            'First paragraph of the note.'
        );
    });

    it('skips blank lines and thematic breaks', () => {
        expect(extractNoteOpening(parseMarkdownBody('---\n\n***\nActual content.'))).toBe('Actual content.');
    });

    it('cleans markdown markers from the opening line', () => {
        expect(extractNoteOpening(parseMarkdownBody('- [ ] A task with a [link](https://example.com)'))).toBe(
            'A task with a link'
        );
    });

    it('skips a GitHub alert marker on its own line and uses the callout body', () => {
        expect(extractNoteOpening(parseMarkdownBody('> [!NOTE]\n> Read this carefully.'))).toBe('Read this carefully.');
    });

    it('drops an alert marker but keeps an inline callout title', () => {
        expect(extractNoteOpening(parseMarkdownBody('> [!tip]+ Pro tip\n> body'))).toBe('Pro tip');
    });

    it('falls back to the first heading when the note is only headings', () => {
        expect(extractNoteOpening(parseMarkdownBody('# Only A Heading\n## Subheading'))).toBe('Only A Heading');
    });

    it('returns an empty string for an empty note', () => {
        expect(extractNoteOpening(parseMarkdownBody(''))).toBe('');
        expect(extractNoteOpening(parseMarkdownBody('\n\n   \n'))).toBe('');
    });
});

describe('extractSectionOpening', () => {
    it('previews prose after the target heading', () => {
        const body = '# Title\n\nIntro prose.\n\n## Setup\n\nRun the installer.';
        const parsed = parseMarkdownBody(body);
        expect(extractSectionOpening(parsed, 5, parsed.lines.length)).toBe('Run the installer.');
    });

    it('does not borrow prose from the next heading when the target section is empty', () => {
        const body = '# Title\n\n## Setup\n\n## Troubleshooting\n\nRestart the app.';
        const parsed = parseMarkdownBody(body);
        const headings = parseMarkdownHeadings(parsed);
        expect(extractSectionOpening(parsed, headings[1].endLineIndex, headings[2].startLineIndex)).toBe('');
    });
});

describe('slugifyHeading', () => {
    it('lowercases, drops punctuation, and hyphenates spaces', () => {
        expect(slugifyHeading('Getting Started with MERN Stack')).toBe('getting-started-with-mern-stack');
        expect(slugifyHeading('What is it, really?')).toBe('what-is-it-really');
    });

    it('keeps underscores and hyphens in rendered text', () => {
        expect(slugifyHeading('snake_case and kebab-case')).toBe('snake_case-and-kebab-case');
    });

    it('matches uslug on emoji and non-Latin scripts, as Joplin renders them', () => {
        expect(slugifyHeading('✅ Features')).toBe('white_check_mark-features');
        expect(slugifyHeading('日本語')).toBe('日本語');
    });

    it('returns an empty slug for headings with no slugifiable characters', () => {
        expect(slugifyHeading('!!!')).toBe('');
    });
});

describe('parseMarkdownHeadings', () => {
    it('returns ATX and Setext headings with rendered text and source ranges', () => {
        const body = '## ATX\n\nSetext *Heading*\n---';

        expect(parseMarkdownHeadings(parseMarkdownBody(body))).toEqual([
            {
                anchor: 'atx',
                text: 'ATX',
                level: 2,
                startLineIndex: 0,
                endLineIndex: 1,
                from: 0,
                to: '## ATX'.length,
            },
            {
                anchor: 'setext-heading',
                text: 'Setext Heading',
                level: 2,
                startLineIndex: 2,
                endLineIndex: 4,
                from: body.indexOf('Setext'),
                to: body.length,
            },
        ]);
    });

    it('ignores heading-like lines in fenced and indented code without affecting duplicate anchors', () => {
        const body =
            '# Intro\n\n' +
            '```md\n## Intro\n```\n\n' +
            '~~~md\n## Other\n~~~\n\n' +
            '    ## Indented\n\n' +
            '## Intro';

        expect(
            parseMarkdownHeadings(parseMarkdownBody(body)).map(({ anchor, text, startLineIndex }) => ({
                anchor,
                text,
                startLineIndex,
            }))
        ).toEqual([
            { anchor: 'intro', text: 'Intro', startLineIndex: 0 },
            { anchor: 'intro-2', text: 'Intro', startLineIndex: 12 },
        ]);
    });

    it('derives slugs from rendered inline text', () => {
        const body = '## A &amp; *bold* [link](https://example.com) `code` ![image](x) <em>HTML</em> ✅ 日本語';

        expect(parseMarkdownHeadings(parseMarkdownBody(body))[0]).toMatchObject({
            text: 'A & bold link code  HTML ✅ 日本語',
            anchor: 'a-bold-link-code-html-white_check_mark-日本語',
        });
    });

    it('keeps unsluggable headings in the index for section boundaries', () => {
        expect(parseMarkdownHeadings(parseMarkdownBody('## !!!'))).toEqual([
            {
                anchor: '',
                text: '!!!',
                level: 2,
                startLineIndex: 0,
                endLineIndex: 1,
                from: 0,
                to: '## !!!'.length,
            },
        ]);
    });

    it('globally disambiguates empty slugs and collisions with their generated anchors', () => {
        const body = '## !!!\n\n## ???\n\n## -2\n\n## !!!';

        expect(parseMarkdownHeadings(parseMarkdownBody(body)).map(({ anchor }) => anchor)).toEqual([
            '',
            '-2',
            '-2-2',
            '-3',
        ]);
    });
});

describe('findHeadingByAnchor', () => {
    const body = '# Title\n\nIntro.\n\n## Getting Started\n\nStep one.\n\n### Notes\n\nDetail.\n\n## Notes\n\nMore.';
    const headings = parseMarkdownHeadings(parseMarkdownBody(body));

    it('locates the heading an anchor names', () => {
        expect(findHeadingByAnchor(headings, 'getting-started')).toEqual({
            anchor: 'getting-started',
            text: 'Getting Started',
            level: 2,
            startLineIndex: 4,
            endLineIndex: 5,
            from: body.indexOf('## Getting Started'),
            to: body.indexOf('## Getting Started') + '## Getting Started'.length,
        });
    });

    it('disambiguates repeated slugs the way Joplin does (first bare, then numbered from two)', () => {
        expect(findHeadingByAnchor(headings, 'notes')?.startLineIndex).toBe(8);
        expect(findHeadingByAnchor(headings, 'notes-2')?.startLineIndex).toBe(12);
        expect(findHeadingByAnchor(headings, 'notes-1')).toBeNull();
    });

    it('keeps generated slugs globally unique when a numbered slug already exists', () => {
        const collidingBody = '## Intro\n\n## Intro-2\n\n## Intro';
        const collidingHeadings = parseMarkdownHeadings(parseMarkdownBody(collidingBody));
        expect(findHeadingByAnchor(collidingHeadings, 'intro')?.startLineIndex).toBe(0);
        expect(findHeadingByAnchor(collidingHeadings, 'intro-2')?.startLineIndex).toBe(2);
        expect(findHeadingByAnchor(collidingHeadings, 'intro-3')?.startLineIndex).toBe(4);
    });

    it('matches case-insensitively and ignores surrounding whitespace', () => {
        expect(findHeadingByAnchor(headings, ' Getting-Started ')?.text).toBe('Getting Started');
    });

    it('returns null for an empty or unresolvable anchor', () => {
        expect(findHeadingByAnchor(headings, '')).toBeNull();
        expect(findHeadingByAnchor(headings, 'no-such-heading')).toBeNull();
    });
});

describe('parseHtmlAnchors', () => {
    it('captures an inline <a id> anchor with its own text and line preview', () => {
        const body = 'Intro paragraph.\n\n<a id="in3b65">The MERN stack</a> is a widely adopted framework.';
        const anchor = parseHtmlAnchors(parseMarkdownBody(body))[0];
        expect(anchor).toMatchObject({
            id: 'in3b65',
            text: 'The MERN stack',
            snippet: 'The MERN stack is a widely adopted framework.',
        });
        expect(body.slice(anchor.from, anchor.to)).toBe('<a id="in3b65">The MERN stack</a>');
    });

    it('covers the whole element for an empty <a id> anchor', () => {
        const body = 'Intro paragraph.\n\n<a id="ab12cd"></a>\n\nBody text here.';
        const anchor = parseHtmlAnchors(parseMarkdownBody(body))[0];
        expect(anchor).toMatchObject({ id: 'ab12cd', text: '' });
        expect(body.slice(anchor.from, anchor.to)).toBe('<a id="ab12cd"></a>');
    });

    it('stops at the opening tag when an <a id> anchor is never closed', () => {
        const body = '<a id="unclosed">dangling';
        const anchor = parseHtmlAnchors(parseMarkdownBody(body))[0];
        expect(body.slice(anchor.from, anchor.to)).toBe('<a id="unclosed">');
    });

    it('stops at the opening tag for a non-anchor tag, whose content is not part of the anchor', () => {
        const body = '<span id="marked">labelled</span>';
        const anchor = parseHtmlAnchors(parseMarkdownBody(body))[0];
        expect(body.slice(anchor.from, anchor.to)).toBe('<span id="marked">');
    });

    it('supports the name attribute, single quotes, and lowercases the id for matching', () => {
        const body = "See <a name='Top'>the top</a>.";
        expect(parseHtmlAnchors(parseMarkdownBody(body))).toEqual([
            expect.objectContaining({ id: 'top', text: 'the top' }),
        ]);
    });

    it('captures an id on a non-anchor tag with no label', () => {
        const body = '<div id="section-2">\n\nBody text here.';
        const anchor = parseHtmlAnchors(parseMarkdownBody(body))[0];
        expect(anchor).toMatchObject({ id: 'section-2', text: '', snippet: 'Body text here.' });
    });

    it('ignores ids written inside fenced or inline code', () => {
        const body = '```html\n<a id="fenced">x</a>\n```\n\nUse `<a id="inline">` in prose.';
        expect(parseHtmlAnchors(parseMarkdownBody(body))).toEqual([]);
    });

    it('keeps duplicate ids as separate entries in document order', () => {
        const body = '<a id="dup">first</a>\n\n<a id="dup">second</a>';
        const anchors = parseHtmlAnchors(parseMarkdownBody(body));
        expect(anchors.map((a) => a.text)).toEqual(['first', 'second']);
        expect(anchors[0].from).toBeLessThan(anchors[1].from);
    });

    it('matches uppercase attribute names, which HTML treats as equivalent', () => {
        expect(parseHtmlAnchors(parseMarkdownBody('<a ID="Top">the top</a>'))).toEqual([
            expect.objectContaining({ id: 'top', text: 'the top' }),
        ]);
        expect(parseHtmlAnchors(parseMarkdownBody('<A NAME="Second">next</A>'))).toEqual([
            expect.objectContaining({ id: 'second', text: 'next' }),
        ]);
    });

    it('ignores prefixed attributes such as data-id and data-name', () => {
        expect(
            parseHtmlAnchors(parseMarkdownBody('<span data-id="oops">x</span> and <span data-name="nope">y</span>'))
        ).toEqual([]);
    });

    it('strips nested markup that a single pass would splice back into a tag', () => {
        const body = '<a id="nested">Safe</a> then <<a>script>alert(1)<</a>/script> tail.';
        expect(parseHtmlAnchors(parseMarkdownBody(body))[0].snippet).toBe('Safe then alert(1) tail.');
    });

    it('captures an anchor written inside a table cell', () => {
        const body = '| Term | Notes |\n| --- | --- |\n| <a id="cell">The MERN stack</a> | popular |\n';
        const anchor = parseHtmlAnchors(parseMarkdownBody(body))[0];
        expect(anchor).toMatchObject({ id: 'cell', text: 'The MERN stack' });
        expect(body.slice(anchor.from, anchor.to)).toBe('<a id="cell">The MERN stack</a>');
    });
});

describe('findHtmlAnchorById', () => {
    const anchors = parseHtmlAnchors(parseMarkdownBody('<a id="alpha">A</a>\n\n<a id="beta">B</a>'));

    it('matches case-insensitively and trims whitespace', () => {
        expect(findHtmlAnchorById(anchors, ' ALPHA ')?.text).toBe('A');
    });

    it('returns the first entry for a duplicate id', () => {
        const dupes = parseHtmlAnchors(parseMarkdownBody('<a id="x">first</a>\n\n<a id="x">second</a>'));
        expect(findHtmlAnchorById(dupes, 'x')?.text).toBe('first');
    });

    it('returns null for an empty or unknown id', () => {
        expect(findHtmlAnchorById(anchors, '')).toBeNull();
        expect(findHtmlAnchorById(anchors, 'gamma')).toBeNull();
    });
});

describe('findOccurrenceOffsets', () => {
    it('finds every occurrence in ascending order', () => {
        expect(findOccurrenceOffsets('a-x-a-x-a', 'a')).toEqual([0, 4, 8]);
        expect(findOccurrenceOffsets('none', 'z')).toEqual([]);
    });
});

describe('extractNoteLinks', () => {
    it('finds internal note links in document order, lowercasing ids', () => {
        const body = `[One](:/${ID_A}) text [Two](:/${ID_B.toUpperCase()}) [One again](:/${ID_A})`;
        expect(extractNoteLinks(body)).toEqual([
            { targetId: ID_A, anchor: '', offset: body.indexOf(`:/${ID_A}`) },
            { targetId: ID_B, anchor: '', offset: body.indexOf(`:/${ID_B.toUpperCase()}`) },
            { targetId: ID_A, anchor: '', offset: body.lastIndexOf(`:/${ID_A}`) },
        ]);
    });

    it('captures a heading anchor, lowercased, without swallowing the closing paren', () => {
        const body = `[Section](:/${ID_A}#Getting-Started) and [Whole](:/${ID_A})`;
        expect(extractNoteLinks(body)).toEqual([
            { targetId: ID_A, anchor: 'getting-started', offset: body.indexOf(`:/${ID_A}`) },
            { targetId: ID_A, anchor: '', offset: body.lastIndexOf(`:/${ID_A}`) },
        ]);
    });

    it('URL-decodes heading anchors before lowercasing them', () => {
        const body = `[Japanese](:/${ID_A}#%E6%97%A5%E6%9C%AC%E8%AA%9E)`;

        expect(extractNoteLinks(body)).toEqual([
            { targetId: ID_A, anchor: '日本語', offset: body.indexOf(`:/${ID_A}`) },
        ]);
    });

    it('preserves malformed URL escapes without aborting link extraction', () => {
        const body = `[Broken](:/${ID_A}#Bad%E0%A4%A)`;

        expect(extractNoteLinks(body)).toEqual([
            { targetId: ID_A, anchor: 'bad%e0%a4%a', offset: body.indexOf(`:/${ID_A}`) },
        ]);
    });

    it('ignores non-note URLs and malformed ids', () => {
        expect(extractNoteLinks('[web](https://example.com) and [short](:/abc)')).toEqual([]);
    });
});

describe('extractOccurrenceContexts', () => {
    it('maps each offset to its line snippet and section', () => {
        const body = `# Heading\nSee [Target](:/${ID_A}) here\nplain`;
        const offsets = findOccurrenceOffsets(body, linkNeedle(ID_A));
        expect(extractOccurrenceContexts(parseMarkdownBody(body), offsets)).toEqual([
            { snippet: 'See Target here', section: 'Heading' },
        ]);
    });

    it('ignores heading-like code and recognizes Setext sections', () => {
        const body =
            `Real Section\n============\n\n` + '```md\n## Fake Section\n```\n\n' + `See [Target](:/${ID_A}) here`;
        const offsets = findOccurrenceOffsets(body, linkNeedle(ID_A));

        expect(extractOccurrenceContexts(parseMarkdownBody(body), offsets)).toEqual([
            { snippet: 'See Target here', section: 'Real Section' },
        ]);
    });

    it('returns an empty array for no offsets', () => {
        expect(extractOccurrenceContexts(parseMarkdownBody('anything'), [])).toEqual([]);
    });
});
