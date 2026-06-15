import type { BacklinkItem } from '../../types';
import { fuzzyFilter } from './fuzzyFilter';

function backlink(id: string, title: string): BacklinkItem {
    return {
        id,
        noteId: id,
        occurrenceIndex: 0,
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

    it('returns no results when the query cannot match any title', () => {
        expect(fuzzyFilter('zzzzzz', backlinks)).toEqual([]);
    });
});
