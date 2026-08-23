import { vi } from 'vitest';
import { JoplinRepository } from './joplinRepository';

describe('JoplinRepository', () => {
    it('paginates searches and owns their query shape', async () => {
        const get = vi.fn().mockImplementation(async (_path: string[], query?: { page?: number }) => {
            if (query?.page === 1) {
                return {
                    items: [{ id: 'first', title: 'First', body: 'one', parent_id: 'folder' }],
                    has_more: true,
                };
            }
            return {
                items: [{ id: 'second', title: 'Second', body: 'two', parent_id: 'folder' }],
                has_more: false,
            };
        });

        await expect(new JoplinRepository({ get }).searchNotes('needle')).resolves.toEqual([
            { id: 'first', title: 'First', body: 'one', parent_id: 'folder' },
            { id: 'second', title: 'Second', body: 'two', parent_id: 'folder' },
        ]);
        expect(get).toHaveBeenNthCalledWith(1, ['search'], {
            query: 'needle',
            fields: ['id', 'title', 'body', 'parent_id'],
            limit: 100,
            page: 1,
        });
        expect(get).toHaveBeenNthCalledWith(2, ['search'], {
            query: 'needle',
            fields: ['id', 'title', 'body', 'parent_id'],
            limit: 100,
            page: 2,
        });
    });

    it('rejects malformed paginated responses', async () => {
        const repository = new JoplinRepository({ get: vi.fn().mockResolvedValue({ has_more: false }) });

        await expect(repository.listFolders()).rejects.toThrow('Joplin returned an invalid folder list.');
    });

    it('requests note bodies separately from lightweight metadata', async () => {
        const get = vi
            .fn()
            .mockResolvedValueOnce({ id: 'note', body: 'Markdown' })
            .mockResolvedValueOnce({ id: 'note', title: 'Title', parent_id: 'folder' });
        const repository = new JoplinRepository({ get });

        await expect(repository.getNoteBody('note')).resolves.toBe('Markdown');
        await expect(repository.getNoteMeta('note')).resolves.toEqual({
            title: 'Title',
            parent_id: 'folder',
            body: '',
        });
        expect(get).toHaveBeenNthCalledWith(1, ['notes', 'note'], { fields: ['id', 'body'] });
        expect(get).toHaveBeenNthCalledWith(2, ['notes', 'note'], {
            fields: ['id', 'title', 'parent_id'],
        });
    });
});
