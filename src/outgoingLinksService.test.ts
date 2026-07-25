import { vi, type Mock } from 'vitest';
import joplin from 'api';
import { countOutgoingLinks, findOutgoingLinks } from './outgoingLinksService';

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

    it('resolves an explicit HTML anchor to its own text and line preview', async () => {
        const body =
            `Whole: [Alpha](:/${NOTE_A}).\n` +
            `Anchor: [The MERN stack](:/${NOTE_A}#in3b65) and again [MERN](:/${NOTE_A}#in3b65).\n` +
            `Stale: [Gone](:/${NOTE_A}#no-such-anchor).`;

        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body };
            }
            if (path[0] === 'notes' && path[1] === NOTE_A) {
                return {
                    id: NOTE_A,
                    title: 'Alpha',
                    parent_id: 'folder-1',
                    body: '# Alpha\n\nAlpha opening line.\n\n<a id="in3b65">The MERN stack</a> is a full-stack framework.',
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
                occurrenceCount: 1,
                title: 'Alpha',
                notebookName: 'Projects',
                section: '',
                snippet: 'Alpha opening line.',
            },
            {
                direction: 'out',
                id: `${NOTE_A}#in3b65`,
                noteId: NOTE_A,
                anchor: 'in3b65',
                occurrenceIndex: 0,
                occurrenceCount: 2,
                title: 'Alpha',
                notebookName: 'Projects',
                // The HTML anchor's own text labels the row; the anchor's line is previewed.
                section: 'The MERN stack',
                snippet: 'The MERN stack is a full-stack framework.',
            },
            {
                direction: 'out',
                id: `${NOTE_A}#no-such-anchor`,
                noteId: NOTE_A,
                anchor: 'no-such-anchor',
                occurrenceIndex: 0,
                occurrenceCount: 1,
                title: 'Alpha',
                notebookName: 'Projects',
                // Resolves to neither heading nor HTML anchor: raw slug + note opening.
                section: 'no-such-anchor',
                snippet: 'Alpha opening line.',
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

describe('countOutgoingLinks', () => {
    beforeEach(() => {
        mockDataGet.mockReset();
    });

    // Four links across three destinations (Alpha, Alpha#intro, Beta) plus one broken target.
    const SOURCE_BODY =
        `See [Beta](:/${NOTE_B}) and [Alpha](:/${NOTE_A}).\n` +
        `Again [Beta](:/${NOTE_B}), plus [Alpha intro](:/${NOTE_A}#intro).\n` +
        `And a [dangling link](:/${NOTE_MISSING}).`;

    /** Resolves Alpha and Beta; Beta's target is missing so it stands in for a broken link. */
    const mockNotes = (): void => {
        mockDataGet.mockImplementation(async (path: string[], options?: { fields?: string[] }) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body: SOURCE_BODY };
            }
            if (path[0] === 'notes' && path[1] === NOTE_A) {
                return { id: NOTE_A, title: 'Alpha', parent_id: 'folder-1', body: '# Intro\n\nAlpha opening.' };
            }
            if (path[0] === 'notes' && path[1] === NOTE_B) {
                return { id: NOTE_B, title: 'Beta', parent_id: 'folder-2', body: 'Beta opening.' };
            }
            if (path[0] === 'notes' && path[1] === NOTE_MISSING) {
                throw new Error('Note not found');
            }
            if (path[0] === 'folders') {
                return { id: path[1], title: `Notebook ${path[1]}` };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')} (fields: ${options?.fields})`);
        });
    };

    it('counts distinct destinations without fetching target bodies or notebooks', async () => {
        mockNotes();

        await expect(countOutgoingLinks(SOURCE_NOTE_ID)).resolves.toBe(3);

        const targetRequests = mockDataGet.mock.calls.filter(
            (call) => call[0][0] === 'notes' && call[0][1] !== SOURCE_NOTE_ID
        );
        // One lookup per distinct target note (Alpha is reused for its anchored destination).
        expect(targetRequests).toHaveLength(3);
        for (const call of targetRequests) {
            expect(call[1].fields).not.toContain('body');
        }
        expect(mockDataGet).not.toHaveBeenCalledWith(['folders', expect.anything()], expect.anything());
    });

    it('agrees with the rows findOutgoingLinks resolves for the same note', async () => {
        mockNotes();

        const rows = await findOutgoingLinks(SOURCE_NOTE_ID);
        const count = await countOutgoingLinks(SOURCE_NOTE_ID);

        expect(count).toBe(rows.length);
    });

    it('omits ignored target notes', async () => {
        mockNotes();

        await expect(countOutgoingLinks(SOURCE_NOTE_ID, { ignoredNoteIds: new Set([NOTE_A]) })).resolves.toBe(1);
    });

    it('returns 0 without fetching when note id is missing', async () => {
        await expect(countOutgoingLinks('')).resolves.toBe(0);
        expect(mockDataGet).not.toHaveBeenCalled();
    });

    it('returns 0 when the note has no internal links', async () => {
        mockDataGet.mockImplementation(async (path: string[]) => {
            if (path[0] === 'notes' && path[1] === SOURCE_NOTE_ID) {
                return { id: SOURCE_NOTE_ID, body: 'Only [a web link](https://example.com).' };
            }
            throw new Error(`Unexpected Data API request: ${path.join('/')}`);
        });

        await expect(countOutgoingLinks(SOURCE_NOTE_ID)).resolves.toBe(0);
    });

    it('returns 0 when the source note cannot be read', async () => {
        mockDataGet.mockRejectedValue(new Error('note unavailable'));

        await expect(countOutgoingLinks(SOURCE_NOTE_ID)).resolves.toBe(0);
    });
});
