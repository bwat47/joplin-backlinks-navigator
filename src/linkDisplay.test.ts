import { getDisplayCounts, getDisplayLinkCount, getDisplayLinks, toBacklinkCounts } from './linkDisplay';
import type { LinkCounts, LinkDirection, LinkItem, LinkPreviewMode } from './types';

const makeLink = (direction: LinkDirection, noteId: string, occurrenceIndex: number): LinkItem => ({
    direction,
    id: `${direction}:${noteId}:${occurrenceIndex}`,
    noteId,
    anchor: '',
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

describe('indicator badge counts', () => {
    const counts: LinkCounts = { backlinkOccurrences: 5, backlinkNotes: 2, outgoing: 3 };

    it('uses distinct source notes for backlinks in title-only mode', () => {
        expect(getDisplayCounts(counts, { in: 'title', out: 'title' })).toEqual({ backlinks: 2, outgoing: 3 });
    });

    it.each<LinkPreviewMode>(['titleSnippet', 'titleSnippetHeading'])(
        'uses every backlink occurrence in %s mode',
        (previewMode) => {
            expect(getDisplayCounts(counts, { in: previewMode, out: 'titleSnippet' })).toEqual({
                backlinks: 5,
                outgoing: 3,
            });
        }
    );

    it('never collapses the outgoing count', () => {
        expect(getDisplayCounts(counts, { in: 'title', out: 'title' }).outgoing).toBe(3);
        expect(getDisplayCounts(counts, { in: 'titleSnippet', out: 'titleSnippet' }).outgoing).toBe(3);
    });

    it.each<LinkPreviewMode>(['title', 'titleSnippet', 'titleSnippetHeading'])(
        'derives the same backlink count from rows as from tallies in %s mode',
        (previewMode) => {
            const items = [makeLink('in', 'a', 0), makeLink('in', 'a', 1), makeLink('in', 'b', 0)];
            const derived = { ...toBacklinkCounts(items), outgoing: 0 };

            expect(getDisplayCounts(derived, { in: previewMode, out: 'titleSnippet' }).backlinks).toBe(
                getDisplayLinkCount(items, 'in', previewMode)
            );
        }
    );
});
