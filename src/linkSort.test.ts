import { dedupeByNoteId } from './linkSort';
import type { LinkItem } from './types';

const makeBacklink = (noteId: string, occurrenceIndex: number): LinkItem => ({
    direction: 'in',
    id: `${noteId}:${occurrenceIndex}`,
    noteId,
    anchor: '',
    occurrenceIndex,
    occurrenceCount: 3,
    title: `Note ${noteId}`,
    notebookName: 'Notebook',
    section: '',
    snippet: `occurrence ${occurrenceIndex}`,
});

describe('dedupeByNoteId', () => {
    it('keeps one row per note, preserving the first occurrence and overall order', () => {
        const items = [
            makeBacklink('a', 0),
            makeBacklink('a', 1),
            makeBacklink('b', 0),
            makeBacklink('a', 2),
            makeBacklink('b', 1),
        ];

        const result = dedupeByNoteId(items);

        expect(result.map((item) => item.id)).toEqual(['a:0', 'b:0']);
    });

    it('returns an empty array unchanged', () => {
        expect(dedupeByNoteId([])).toEqual([]);
    });

    it('leaves an already-distinct list untouched', () => {
        const items = [makeBacklink('a', 0), makeBacklink('b', 0)];
        expect(dedupeByNoteId(items)).toEqual(items);
    });
});
