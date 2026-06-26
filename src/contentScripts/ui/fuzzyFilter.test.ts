import type { LinkItem } from '../../types';
import { fuzzyFilter } from './fuzzyFilter';

function backlink(id: string, title: string, occurrenceIndex = 0, noteId = id): LinkItem {
    return {
        direction: 'in',
        id,
        noteId,
        occurrenceIndex,
        occurrenceCount: 1,
        title,
        notebookName: '',
        section: '',
        snippet: '',
    };
}

describe('fuzzyFilter', () => {
    const backlinks = [
        backlink('alpha', 'Alpha Project'),
        backlink('meeting', 'Meeting Notes'),
        backlink('recipe', 'Recipe Ideas'),
    ];

    it('returns a copy in original order for an empty query', () => {
        const result = fuzzyFilter('   ', backlinks);

        expect(result).toEqual(backlinks);
        expect(result).not.toBe(backlinks);
    });

    it('matches backlinks by fuzzy title query', () => {
        expect(fuzzyFilter('al pr', backlinks).map((item) => item.id)).toEqual(['alpha']);
    });

    it('orders same-note backlink ties by occurrence index', () => {
        const repeatedBacklinks = [
            backlink('source:1', 'Source Note', 1, 'source'),
            backlink('source:0', 'Source Note', 0, 'source'),
        ];

        expect(fuzzyFilter('source', repeatedBacklinks).map((item) => item.id)).toEqual(['source:0', 'source:1']);
    });

    it('returns no results when the query cannot match any title', () => {
        expect(fuzzyFilter('zzzzzz', backlinks)).toEqual([]);
    });
});
