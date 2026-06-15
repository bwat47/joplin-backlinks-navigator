import joplin from 'api';
import { findBacklinks } from './backlinksService';

jest.mock('api', () => ({
    __esModule: true,
    default: {
        data: {
            get: jest.fn(),
        },
    },
}));

const mockDataGet = joplin.data.get as jest.Mock;
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
                                body: `# References\n- [Current note](:/${TARGET_NOTE_ID}) and [site](https://example.com)`,
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
                id: 'note-a',
                title: 'Alpha',
                notebookName: 'Projects',
                section: 'Context',
                snippet: 'Diagram see Target',
            },
            {
                id: 'note-z',
                title: 'Zulu',
                notebookName: 'Projects',
                section: 'References',
                snippet: 'Current note and site',
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
});
