import { vi, type Mock } from 'vitest';
import joplin from 'api';
import { findBacklinks } from './backlinksService';

vi.mock('api', () => ({
    __esModule: true,
    default: {
        data: {
            get: vi.fn(),
        },
    },
}));

const mockDataGet = joplin.data.get as Mock;
const TARGET_NOTE_ID = '0123456789abcdef0123456789abcdef';

describe('findBacklinks', () => {
    beforeEach(() => {
        mockDataGet.mockReset();
    });

    it('paginates search results, filters candidates, resolves notebooks, and sorts by title', async () => {
        mockDataGet.mockImplementation(async (path: string[], options?: { page?: number }) => {
            if (path[0] === 'search') {
                if (options?.page === 1) {
                    return {
                        items: [
                            {
                                id: 'note-z',
                                title: 'Zulu',
                                body:
                                    `# References\n- [Current note](:/${TARGET_NOTE_ID}) and ` +
                                    `[site](https://example.com)\n## Follow-up\n- [Again](:/${TARGET_NOTE_ID})`,
                                parent_id: 'folder-1',
                            },
                            {
                                id: TARGET_NOTE_ID,
                                title: 'Self',
                                body: `Links to itself [Self](:/${TARGET_NOTE_ID})`,
                                parent_id: 'folder-1',
                            },
                            {
                                id: 'loose-match',
                                title: 'Loose match',
                                body: `Mentions ${TARGET_NOTE_ID} without a note link prefix`,
                                parent_id: 'folder-1',
                            },
                        ],
                        has_more: true,
                    };
                }

                return {
                    items: [
                        {
                            id: 'note-a',
                            title: 'Alpha',
                            body: `Intro\n## Context ##\n> ![Diagram](:/resource-id) see [Target](:/${TARGET_NOTE_ID}#context)`,
                            parent_id: 'folder-1',
                        },
                    ],
                    has_more: false,
                };
            }

            if (path[0] === 'folders' && path[1] === 'folder-1') {
                return { id: 'folder-1', title: 'Projects' };
            }

            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        await expect(findBacklinks(TARGET_NOTE_ID)).resolves.toEqual([
            {
                direction: 'in',
                id: 'note-a:0',
                noteId: 'note-a',
                occurrenceIndex: 0,
                occurrenceCount: 1,
                title: 'Alpha',
                notebookName: 'Projects',
                section: 'Context',
                snippet: 'Diagram see Target',
            },
            {
                direction: 'in',
                id: 'note-z:0',
                noteId: 'note-z',
                occurrenceIndex: 0,
                occurrenceCount: 2,
                title: 'Zulu',
                notebookName: 'Projects',
                section: 'References',
                snippet: 'Current note and site',
            },
            {
                direction: 'in',
                id: 'note-z:1',
                noteId: 'note-z',
                occurrenceIndex: 1,
                occurrenceCount: 2,
                title: 'Zulu',
                notebookName: 'Projects',
                section: 'Follow-up',
                snippet: 'Again',
            },
        ]);

        expect(mockDataGet).toHaveBeenCalledWith(
            ['search'],
            expect.objectContaining({ query: TARGET_NOTE_ID, limit: 100, page: 1 })
        );
        expect(mockDataGet).toHaveBeenCalledWith(
            ['search'],
            expect.objectContaining({ query: TARGET_NOTE_ID, limit: 100, page: 2 })
        );
        expect(mockDataGet).toHaveBeenCalledWith(['folders', 'folder-1'], { fields: ['id', 'title'] });
    });

    it('returns an empty list without searching when note id is missing', async () => {
        await expect(findBacklinks('')).resolves.toEqual([]);
        expect(mockDataGet).not.toHaveBeenCalled();
    });

    it('omits backlinks from ignored source notes', async () => {
        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'search') {
                return {
                    items: [
                        {
                            id: 'note-a',
                            title: 'Alpha',
                            body: `[Target](:/${TARGET_NOTE_ID})`,
                            parent_id: 'folder-1',
                        },
                        {
                            id: 'note-z',
                            title: 'Zulu',
                            body: `[Target](:/${TARGET_NOTE_ID})`,
                            parent_id: 'folder-2',
                        },
                    ],
                    has_more: false,
                };
            }

            if (path[0] === 'folders' && path[1] === 'folder-1') {
                return { id: 'folder-1', title: 'Projects' };
            }

            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        await expect(findBacklinks(TARGET_NOTE_ID, { ignoredNoteIds: new Set(['note-z']) })).resolves.toEqual([
            {
                direction: 'in',
                id: 'note-a:0',
                noteId: 'note-a',
                occurrenceIndex: 0,
                occurrenceCount: 1,
                title: 'Alpha',
                notebookName: 'Projects',
                section: '',
                snippet: 'Target',
            },
        ]);

        expect(mockDataGet).not.toHaveBeenCalledWith(['folders', 'folder-2'], expect.anything());
    });
});
