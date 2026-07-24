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
                anchor: '',
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
                anchor: '',
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
                anchor: '',
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

    it('splits heading-anchor links into their own rows, deduping repeats of each', async () => {
        const body =
            `Whole note: [Alpha](:/${NOTE_A}) and again [Alpha](:/${NOTE_A}).\n` +
            `Section: [Setup @ Alpha](:/${NOTE_A}#setup) and again [Setup](:/${NOTE_A}#setup).\n` +
            `Stale: [Gone](:/${NOTE_A}#removed-heading).`;

        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body };
            }
            if (path[0] === 'notes' && path[1] === NOTE_A) {
                return {
                    id: NOTE_A,
                    title: 'Alpha',
                    parent_id: 'folder-1',
                    body: '# Alpha\n\nAlpha opening line.\n\n## Setup\n\nRun the installer.',
                };
            }
            if (path[0] === 'folders' && path[1] === 'folder-1') {
                return { id: 'folder-1', title: 'Projects' };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        await expect(findOutgoingLinks(SOURCE_NOTE_ID)).resolves.toEqual([
            {
                direction: 'out',
                id: NOTE_A,
                noteId: NOTE_A,
                anchor: '',
                occurrenceIndex: 0,
                occurrenceCount: 2,
                title: 'Alpha',
                notebookName: 'Projects',
                section: '',
                snippet: 'Alpha opening line.',
            },
            {
                direction: 'out',
                id: `${NOTE_A}#removed-heading`,
                noteId: NOTE_A,
                anchor: 'removed-heading',
                occurrenceIndex: 0,
                occurrenceCount: 1,
                title: 'Alpha',
                notebookName: 'Projects',
                // Anchor no longer names a heading: show the raw slug and the note's opening.
                section: 'removed-heading',
                snippet: 'Alpha opening line.',
            },
            {
                direction: 'out',
                id: `${NOTE_A}#setup`,
                noteId: NOTE_A,
                anchor: 'setup',
                occurrenceIndex: 0,
                occurrenceCount: 2,
                title: 'Alpha',
                notebookName: 'Projects',
                section: 'Setup',
                snippet: 'Run the installer.',
            },
        ]);
    });

    it('resolves URL-encoded anchors and dedupes them with the equivalent decoded anchor', async () => {
        const body = `[Encoded](:/${NOTE_A}#%E6%97%A5%E6%9C%AC%E8%AA%9E) and ` + `[Decoded](:/${NOTE_A}#日本語).`;

        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body };
            }
            if (path[0] === 'notes' && path[1] === NOTE_A) {
                return {
                    id: NOTE_A,
                    title: 'Alpha',
                    parent_id: 'folder-1',
                    body: '# Alpha\n\n## 日本語\n\n日本語の内容。',
                };
            }
            if (path[0] === 'folders' && path[1] === 'folder-1') {
                return { id: 'folder-1', title: 'Projects' };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        await expect(findOutgoingLinks(SOURCE_NOTE_ID)).resolves.toEqual([
            {
                direction: 'out',
                id: `${NOTE_A}#日本語`,
                noteId: NOTE_A,
                anchor: '日本語',
                occurrenceIndex: 0,
                occurrenceCount: 2,
                title: 'Alpha',
                notebookName: 'Projects',
                section: '日本語',
                snippet: '日本語の内容。',
            },
        ]);
    });

    it('does not let an empty anchored section preview prose from the next section', async () => {
        const body = `[Setup](:/${NOTE_A}#setup).`;

        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body };
            }
            if (path[0] === 'notes' && path[1] === NOTE_A) {
                return {
                    id: NOTE_A,
                    title: 'Alpha',
                    parent_id: 'folder-1',
                    body: '# Alpha\n\n## Setup\n\n## Troubleshooting\n\nRestart the app.',
                };
            }
            if (path[0] === 'folders' && path[1] === 'folder-1') {
                return { id: 'folder-1', title: 'Projects' };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        const result = await findOutgoingLinks(SOURCE_NOTE_ID);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            anchor: 'setup',
            section: 'Setup',
            snippet: '',
        });
    });

    it('resolves Setext headings without treating fenced examples as duplicate headings', async () => {
        const body = `[Setup](:/${NOTE_A}#setup).`;

        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body };
            }
            if (path[0] === 'notes' && path[1] === NOTE_A) {
                return {
                    id: NOTE_A,
                    title: 'Alpha',
                    parent_id: 'folder-1',
                    body:
                        '# Alpha\n\n' +
                        '```md\n## Setup\n```\n\n' +
                        'Setup\n-----\n\n' +
                        'Run the correct installer.\n\n' +
                        '## Troubleshooting\n\nRestart the app.',
                };
            }
            if (path[0] === 'folders' && path[1] === 'folder-1') {
                return { id: 'folder-1', title: 'Projects' };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        const result = await findOutgoingLinks(SOURCE_NOTE_ID);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            anchor: 'setup',
            section: 'Setup',
            snippet: 'Run the correct installer.',
        });
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
