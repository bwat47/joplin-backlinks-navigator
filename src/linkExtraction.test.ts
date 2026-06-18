import {
    cleanSnippetLine,
    extractNoteLinks,
    extractOccurrenceContexts,
    findOccurrenceOffsets,
    findSection,
    linkNeedle,
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
            { targetId: ID_A, offset: body.indexOf(`:/${ID_A}`) },
            { targetId: ID_B, offset: body.indexOf(`:/${ID_B.toUpperCase()}`) },
            { targetId: ID_A, offset: body.lastIndexOf(`:/${ID_A}`) },
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
