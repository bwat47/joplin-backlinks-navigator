import {
    cleanSnippetLine,
    extractNoteLinks,
    extractNoteOpening,
    extractOccurrenceContexts,
    findHeadingByAnchor,
    findOccurrenceOffsets,
    findSection,
    linkNeedle,
    slugifyHeading,
} from './linkExtraction';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

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
        const lines = ['# Top', 'intro', '## Sub', 'body'];
        expect(findSection(lines, 3)).toBe('Sub');
        expect(findSection(lines, 1)).toBe('Top');
    });

    it('returns empty string when there is no heading above', () => {
        expect(findSection(['just text', 'more'], 1)).toBe('');
    });
});

describe('extractNoteOpening', () => {
    it('returns the first line of prose, skipping a leading heading', () => {
        expect(extractNoteOpening('# Title\n\nFirst paragraph of the note.')).toBe('First paragraph of the note.');
    });

    it('skips blank lines and thematic breaks', () => {
        expect(extractNoteOpening('---\n\n***\nActual content.')).toBe('Actual content.');
    });

    it('cleans markdown markers from the opening line', () => {
        expect(extractNoteOpening('- [ ] A task with a [link](https://example.com)')).toBe('A task with a link');
    });

    it('skips a GitHub alert marker on its own line and uses the callout body', () => {
        expect(extractNoteOpening('> [!NOTE]\n> Read this carefully.')).toBe('Read this carefully.');
    });

    it('drops an alert marker but keeps an inline callout title', () => {
        expect(extractNoteOpening('> [!tip]+ Pro tip\n> body')).toBe('Pro tip');
    });

    it('falls back to the first heading when the note is only headings', () => {
        expect(extractNoteOpening('# Only A Heading\n## Subheading')).toBe('Only A Heading');
    });

    it('returns an empty string for an empty note', () => {
        expect(extractNoteOpening('')).toBe('');
        expect(extractNoteOpening('\n\n   \n')).toBe('');
    });

    it('starts from the requested line so anchored links preview their own section', () => {
        const body = '# Title\n\nIntro prose.\n\n## Setup\n\nRun the installer.';
        expect(extractNoteOpening(body, 5)).toBe('Run the installer.');
    });
});

describe('slugifyHeading', () => {
    it('lowercases, drops punctuation, and hyphenates spaces', () => {
        expect(slugifyHeading('Getting Started with MERN Stack')).toBe('getting-started-with-mern-stack');
        expect(slugifyHeading('What is it, really?')).toBe('what-is-it-really');
    });

    it('strips inline markdown but keeps underscores and hyphens', () => {
        expect(slugifyHeading('Using **bold** and `code`')).toBe('using-bold-and-code');
        expect(slugifyHeading('An ==important== ++new++ ~~old~~ thing')).toBe('an-important-new-old-thing');
        expect(slugifyHeading('The [docs](https://example.com) page')).toBe('the-docs-page');
        expect(slugifyHeading('An ![icon](:/abc) here')).toBe('an-icon-here');
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

describe('findHeadingByAnchor', () => {
    const body = '# Title\n\nIntro.\n\n## Getting Started\n\nStep one.\n\n### Notes\n\nDetail.\n\n## Notes\n\nMore.';

    it('locates the heading an anchor names', () => {
        expect(findHeadingByAnchor(body, 'getting-started')).toEqual({
            text: 'Getting Started',
            lineIndex: 4,
            offset: body.indexOf('## Getting Started'),
            lineLength: '## Getting Started'.length,
        });
    });

    it('disambiguates repeated slugs the way Joplin does (first bare, then numbered from two)', () => {
        expect(findHeadingByAnchor(body, 'notes')?.lineIndex).toBe(8);
        expect(findHeadingByAnchor(body, 'notes-2')?.lineIndex).toBe(12);
        expect(findHeadingByAnchor(body, 'notes-1')).toBeNull();
    });

    it('matches case-insensitively and ignores surrounding whitespace', () => {
        expect(findHeadingByAnchor(body, ' Getting-Started ')?.text).toBe('Getting Started');
    });

    it('returns null for an empty or unresolvable anchor', () => {
        expect(findHeadingByAnchor(body, '')).toBeNull();
        expect(findHeadingByAnchor(body, 'no-such-heading')).toBeNull();
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

    it('ignores non-note URLs and malformed ids', () => {
        expect(extractNoteLinks('[web](https://example.com) and [short](:/abc)')).toEqual([]);
    });
});

describe('extractOccurrenceContexts', () => {
    it('maps each offset to its line snippet and section', () => {
        const body = `# Heading\nSee [Target](:/${ID_A}) here\nplain`;
        const offsets = findOccurrenceOffsets(body, linkNeedle(ID_A));
        expect(extractOccurrenceContexts(body, offsets)).toEqual([{ snippet: 'See Target here', section: 'Heading' }]);
    });

    it('returns an empty array for no offsets', () => {
        expect(extractOccurrenceContexts('anything', [])).toEqual([]);
    });
});
