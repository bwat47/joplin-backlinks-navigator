import { vi, type Mock } from 'vitest';
import joplin from 'api';
import { countBacklinks, findBacklinks } from './backlinksService';

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
                anchor: '',
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
                anchor: '',
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
                anchor: '',
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
                anchor: '',
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

    it('returns one backlink per rendered reference use and ignores non-link matches', async () => {
        const first = '[First][current]';
        const second = '[Second][current]';
        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'search') {
                return {
                    items: [
                        {
                            id: 'references',
                            title: 'References',
                            body:
                                `# Links\n\`[code](:/${TARGET_NOTE_ID})\`\n${first}\n${second}\n\n` +
                                `[current]: :/${TARGET_NOTE_ID}`,
                            parent_id: 'folder-1',
                        },
                        {
                            id: 'false-only',
                            title: 'Code example',
                            body: `\`\`\`md\n[Example](:/${TARGET_NOTE_ID})\n\`\`\``,
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

        const result = await findBacklinks(TARGET_NOTE_ID);

        expect(result).toHaveLength(2);
        expect(result.map((row) => row.snippet)).toEqual(['First', 'Second']);
        expect(result.map((row) => row.occurrenceIndex)).toEqual([0, 1]);
        expect(result.every((row) => row.occurrenceCount === 2)).toBe(true);
    });
});

describe('countBacklinks', () => {
    beforeEach(() => {
        mockDataGet.mockReset();
    });

    /** Two linking notes (one linking twice), plus a self-link and a loose FTS match to discard. */
    const mockSearchResults = (resolveFolders: boolean): void => {
        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'search') {
                return {
                    items: [
                        {
                            id: 'note-z',
                            title: 'Zulu',
                            body: `[Current](:/${TARGET_NOTE_ID}) and again [Current](:/${TARGET_NOTE_ID})`,
                            parent_id: 'folder-1',
                        },
                        {
                            id: 'note-a',
                            title: 'Alpha',
                            body: `# Notes\n[Current](:/${TARGET_NOTE_ID})`,
                            parent_id: 'folder-2',
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
                        {
                            id: 'code-example',
                            title: 'Code example',
                            body: `\`\`\`md\n[Current](:/${TARGET_NOTE_ID})\n\`\`\``,
                            parent_id: 'folder-1',
                        },
                    ],
                    has_more: false,
                };
            }
            if (resolveFolders && path[0] === 'folders') {
                return { id: path[1], title: `Notebook ${path[1]}` };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });
    };

    it('counts occurrences and source notes without resolving notebooks', async () => {
        // The mock throws on any non-search request, so a notebook lookup here would fail the test.
        mockSearchResults(false);

        await expect(countBacklinks(TARGET_NOTE_ID)).resolves.toEqual({ occurrences: 3, notes: 2 });
        expect(mockDataGet).toHaveBeenCalledTimes(1);
    });

    it('agrees with the rows findBacklinks resolves for the same note', async () => {
        mockSearchResults(true);

        const rows = await findBacklinks(TARGET_NOTE_ID);
        const counts = await countBacklinks(TARGET_NOTE_ID);

        expect(counts.occurrences).toBe(rows.length);
        expect(counts.notes).toBe(new Set(rows.map((row) => row.noteId)).size);
    });

    it('omits ignored source notes', async () => {
        mockSearchResults(false);

        await expect(countBacklinks(TARGET_NOTE_ID, { ignoredNoteIds: new Set(['note-z']) })).resolves.toEqual({
            occurrences: 1,
            notes: 1,
        });
    });

    it('returns zeros without searching when note id is missing', async () => {
        await expect(countBacklinks('')).resolves.toEqual({ occurrences: 0, notes: 0 });
        expect(mockDataGet).not.toHaveBeenCalled();
    });

    it('returns zeros when the search fails', async () => {
        mockDataGet.mockRejectedValue(new Error('search unavailable'));

        await expect(countBacklinks(TARGET_NOTE_ID)).resolves.toEqual({ occurrences: 0, notes: 0 });
    });
});
