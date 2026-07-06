import { vi, type Mock } from 'vitest';
import joplin from 'api';
import { findOutgoingLinks } from './outgoingLinksService';

vi.mock('api', () => ({
    __esModule: true,
    default: {
        data: {
            get: vi.fn(),
        },
    },
}));

const mockDataGet = joplin.data.get as Mock;

const SOURCE_NOTE_ID = '0123456789abcdef0123456789abcdef';
const NOTE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NOTE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NOTE_MISSING = 'cccccccccccccccccccccccccccccccc';

describe('findOutgoingLinks', () => {
    beforeEach(() => {
        mockDataGet.mockReset();
    });

    it('dedupes per target, counts occurrences, resolves metadata, and sorts by title', async () => {
        const body =
            `# Intro\n` +
            `See [Beta](:/${NOTE_B}) and [Alpha](:/${NOTE_A}).\n` +
            `## Recap\n` +
            `Again [Beta again](:/${NOTE_B}).`;

        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body };
            }
            if (path[0] === 'notes' && path[1] === NOTE_A) {
                return { id: NOTE_A, title: 'Alpha', parent_id: 'folder-1', body: '# Alpha\n\nAlpha opening line.' };
            }
            if (path[0] === 'notes' && path[1] === NOTE_B) {
                return { id: NOTE_B, title: 'Beta', parent_id: 'folder-2', body: 'Beta opening line.' };
            }
            if (path[0] === 'folders' && path[1] === 'folder-1') {
                return { id: 'folder-1', title: 'Projects' };
            }
            if (path[0] === 'folders' && path[1] === 'folder-2') {
                return { id: 'folder-2', title: 'Archive' };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        await expect(findOutgoingLinks(SOURCE_NOTE_ID)).resolves.toEqual([
            {
                direction: 'out',
                id: NOTE_A,
                noteId: NOTE_A,
                occurrenceIndex: 0,
                occurrenceCount: 1,
                title: 'Alpha',
                notebookName: 'Projects',
                section: '',
                snippet: 'Alpha opening line.',
            },
            {
                direction: 'out',
                id: NOTE_B,
                noteId: NOTE_B,
                occurrenceIndex: 0,
                occurrenceCount: 2,
                title: 'Beta',
                notebookName: 'Archive',
                section: '',
                snippet: 'Beta opening line.',
            },
        ]);
    });

    it('skips self-links, ignored notes, and broken (unresolvable) links', async () => {
        const body =
            `Self [self](:/${SOURCE_NOTE_ID}).\n` +
            `[Alpha](:/${NOTE_A}) [Ignored](:/${NOTE_B}) [Broken](:/${NOTE_MISSING}).`;

        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body };
            }
            if (path[0] === 'notes' && path[1] === NOTE_A) {
                return { id: NOTE_A, title: 'Alpha', parent_id: 'folder-1', body: 'Alpha opening line.' };
            }
            if (path[0] === 'notes' && path[1] === NOTE_MISSING) {
                throw new Error('not found');
            }
            if (path[0] === 'folders' && path[1] === 'folder-1') {
                return { id: 'folder-1', title: 'Projects' };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        await expect(findOutgoingLinks(SOURCE_NOTE_ID, { ignoredNoteIds: new Set([NOTE_B]) })).resolves.toEqual([
            {
                direction: 'out',
                id: NOTE_A,
                noteId: NOTE_A,
                occurrenceIndex: 0,
                occurrenceCount: 1,
                title: 'Alpha',
                notebookName: 'Projects',
                section: '',
                snippet: 'Alpha opening line.',
            },
        ]);

        // The ignored note is never even fetched.
        expect(mockDataGet).not.toHaveBeenCalledWith(['notes', NOTE_B], expect.anything());
    });

    it('returns an empty list without fetching when note id is missing', async () => {
        await expect(findOutgoingLinks('')).resolves.toEqual([]);
        expect(mockDataGet).not.toHaveBeenCalled();
    });

    it('returns an empty list when the note has no internal links', async () => {
        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body: 'No links here, just [a web link](https://example.com).' };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        await expect(findOutgoingLinks(SOURCE_NOTE_ID)).resolves.toEqual([]);
    });
});
