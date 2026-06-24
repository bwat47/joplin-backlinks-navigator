import { getDisplayLinkCount, getDisplayLinks } from './linkDisplay';
import type { LinkDirection, LinkItem, LinkPreviewMode } from './types';

const makeLink = (direction: LinkDirection, noteId: string, occurrenceIndex: number): LinkItem => ({
    direction,
    id: `${direction}:${noteId}:${occurrenceIndex}`,
    noteId,
    occurrenceIndex,
    occurrenceCount: 3,
    title: `Note ${noteId}`,
    notebookName: 'Notebook',
    section: '',
    snippet: `occurrence ${occurrenceIndex}`,
});

describe('link display policy', () => {
    it('collapses inbound backlinks in title-only mode', () => {
        const items = [makeLink('in', 'a', 0), makeLink('in', 'a', 1), makeLink('in', 'b', 0)];

        const result = getDisplayLinks(items, 'in', 'title');

        expect(result.map((item) => item.id)).toEqual(['in:a:0', 'in:b:0']);
        expect(getDisplayLinkCount(items, 'in', 'title')).toBe(2);
    });

    it.each<LinkPreviewMode>(['titleSnippet', 'titleSnippetHeading'])(
        'keeps inbound occurrence rows in %s mode',
        (previewMode) => {
            const items = [makeLink('in', 'a', 0), makeLink('in', 'a', 1), makeLink('in', 'b', 0)];

            expect(getDisplayLinks(items, 'in', previewMode).map((item) => item.id)).toEqual([
                'in:a:0',
                'in:a:1',
                'in:b:0',
            ]);
            expect(getDisplayLinkCount(items, 'in', previewMode)).toBe(3);
        }
    );

    it('does not collapse outgoing links in title-only mode', () => {
        const items = [makeLink('out', 'a', 0), makeLink('out', 'a', 1), makeLink('out', 'b', 0)];

        expect(getDisplayLinks(items, 'out', 'title').map((item) => item.id)).toEqual([
            'out:a:0',
            'out:a:1',
            'out:b:0',
        ]);
        expect(getDisplayLinkCount(items, 'out', 'title')).toBe(3);
    });
});
