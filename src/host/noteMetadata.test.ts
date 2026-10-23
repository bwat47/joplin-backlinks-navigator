import { vi, describe, beforeEach, it, expect } from 'vitest';
import { JoplinRepository } from './joplinRepository';
import {
    expandIgnoredFolderIds,
    resolveNoteMeta,
    resolveNoteWithBody,
    resolveNotebookName,
    type NoteMetaCache,
    type NoteWithBodyCache,
    type NotebookNameCache,
} from './noteMetadata';

const mockDataGet = vi.fn();
const repository = new JoplinRepository({ get: mockDataGet });

const ROOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CHILD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const GRANDCHILD = 'cccccccccccccccccccccccccccccccc';
const UNRELATED = 'dddddddddddddddddddddddddddddddd';

describe('expandIgnoredFolderIds', () => {
    beforeEach(() => {
        mockDataGet.mockReset();
    });

    it('returns the configured set without listing notebooks when nothing is ignored', async () => {
        const configured = new Set<string>();

        await expect(expandIgnoredFolderIds(repository, configured)).resolves.toBe(configured);
        expect(mockDataGet).not.toHaveBeenCalled();
    });

    it('collects nested descendants across paginated folder listings', async () => {
        mockDataGet.mockImplementation(async (path: string[], options?: { page?: number }) => {
            if (path[0] !== 'folders') {
                throw new Error(`Unexpected Data API request: ${path.join('/')}`);
            }
            if (options?.page === 1) {
                return {
                    items: [
                        { id: ROOT, parent_id: '' },
                        { id: CHILD, parent_id: ROOT },
                    ],
                    has_more: true,
                };
            }
            return {
                items: [
                    { id: GRANDCHILD, parent_id: CHILD },
                    { id: UNRELATED, parent_id: '' },
                ],
                has_more: false,
            };
        });

        await expect(expandIgnoredFolderIds(repository, new Set([ROOT]))).resolves.toEqual(
            new Set([ROOT, CHILD, GRANDCHILD])
        );
        expect(mockDataGet).toHaveBeenCalledTimes(2);
    });

    it('terminates on a malformed parent cycle', async () => {
        mockDataGet.mockResolvedValue({
            items: [
                { id: ROOT, parent_id: CHILD },
                { id: CHILD, parent_id: ROOT },
            ],
            has_more: false,
        });

        await expect(expandIgnoredFolderIds(repository, new Set([ROOT]))).resolves.toEqual(new Set([ROOT, CHILD]));
    });

    it('falls back to the configured notebooks when the folder listing fails', async () => {
        mockDataGet.mockRejectedValue(new Error('offline'));

        await expect(expandIgnoredFolderIds(repository, new Set([ROOT]))).resolves.toEqual(new Set([ROOT]));
    });
});

describe('metadata lookup caches', () => {
    beforeEach(() => {
        mockDataGet.mockReset();
    });

    it('shares one notebook lookup between concurrent requests for the same id', async () => {
        mockDataGet.mockResolvedValue({ id: ROOT, title: 'Projects' });
        const cache: NotebookNameCache = new Map();

        const names = await Promise.all([
            resolveNotebookName(repository, ROOT, cache),
            resolveNotebookName(repository, ROOT, cache),
        ]);

        expect(names).toEqual(['Projects', 'Projects']);
        expect(mockDataGet).toHaveBeenCalledTimes(1);
    });

    it('shares one note lookup between concurrent requests, including a failed one', async () => {
        mockDataGet.mockRejectedValue(new Error('Note not found'));
        const cache: NoteMetaCache = new Map();

        const metas = await Promise.all([
            resolveNoteMeta(repository, CHILD, cache),
            resolveNoteMeta(repository, CHILD, cache),
        ]);

        expect(metas).toEqual([null, null]);
        expect(mockDataGet).toHaveBeenCalledTimes(1);
    });

    it('resolves a note with its body through its own cache', async () => {
        mockDataGet.mockResolvedValue({ id: CHILD, title: 'Child', parent_id: ROOT, body: 'Markdown' });
        const cache: NoteWithBodyCache = new Map();

        const notes = await Promise.all([
            resolveNoteWithBody(repository, CHILD, cache),
            resolveNoteWithBody(repository, CHILD, cache),
        ]);

        expect(notes).toEqual([
            { title: 'Child', parent_id: ROOT, isTrashed: false, body: 'Markdown' },
            { title: 'Child', parent_id: ROOT, isTrashed: false, body: 'Markdown' },
        ]);
        expect(mockDataGet).toHaveBeenCalledExactlyOnceWith(['notes', CHILD], {
            fields: ['id', 'title', 'parent_id', 'deleted_time', 'body'],
        });
    });
});
