import { extractHeadingAnchors, findHeadingByAnchor } from './headingAnchors';

describe('extractHeadingAnchors', () => {
    it('extracts ATX headings with their rendered ids and source ranges', () => {
        const body = '# Title\n\n## Getting Started\n\nStep one.';

        expect(extractHeadingAnchors(body)).toEqual([
            {
                anchor: 'title',
                text: 'Title',
                level: 1,
                lineIndex: 0,
                endLineIndex: 1,
                from: 0,
                to: '# Title'.length,
            },
            {
                anchor: 'getting-started',
                text: 'Getting Started',
                level: 2,
                lineIndex: 2,
                endLineIndex: 3,
                from: body.indexOf('## Getting Started'),
                to: body.indexOf('## Getting Started') + '## Getting Started'.length,
            },
        ]);
    });

    it('supports Setext headings and includes both source lines in the range', () => {
        const body = 'Getting Started\n===============\n\nStep one.';

        expect(extractHeadingAnchors(body)).toEqual([
            {
                anchor: 'getting-started',
                text: 'Getting Started',
                level: 1,
                lineIndex: 0,
                endLineIndex: 2,
                from: 0,
                to: body.indexOf('\n\n'),
            },
        ]);
    });

    it('maps source ranges correctly in CRLF documents', () => {
        const body = '# Title\r\n\r\nBody';
        expect(extractHeadingAnchors(body)[0]).toMatchObject({
            lineIndex: 0,
            endLineIndex: 1,
            from: 0,
            to: '# Title'.length,
        });
    });

    it('uses parsed inline text exactly as markdown-it-anchor does', () => {
        const body = '# An ![icon](image.png) &amp; [docs](https://example.com) `code` <span>HTML</span>';

        expect(extractHeadingAnchors(body)[0]).toMatchObject({
            anchor: 'an-docs-code-html',
            text: 'An & docs code HTML',
        });
    });

    it('matches Joplin uslug behavior for emoji and non-Latin scripts', () => {
        const headings = extractHeadingAnchors('# ✅ Features\n\n# 日本語');
        expect(headings.map((heading) => heading.anchor)).toEqual(['white_check_mark-features', '日本語']);
    });

    it('makes slugs globally unique even when a generated suffix collides with another heading', () => {
        const headings = extractHeadingAnchors('# Intro\n# Intro-2\n# Intro');
        expect(headings.map((heading) => heading.anchor)).toEqual(['intro', 'intro-2', 'intro-3']);
    });

    it('ignores heading-like text inside fenced code blocks', () => {
        expect(extractHeadingAnchors('```\n# Not a heading\n```')).toEqual([]);
    });
});

describe('findHeadingByAnchor', () => {
    const headings = extractHeadingAnchors('# Title\n\n## Getting Started');

    it('matches case-insensitively and ignores surrounding whitespace', () => {
        expect(findHeadingByAnchor(headings, ' Getting-Started ')?.text).toBe('Getting Started');
    });

    it('returns null for an empty or unresolvable anchor', () => {
        expect(findHeadingByAnchor(headings, '')).toBeNull();
        expect(findHeadingByAnchor(headings, 'no-such-heading')).toBeNull();
    });
});
