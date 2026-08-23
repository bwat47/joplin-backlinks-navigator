const PAGE_SIZE = 100;
// Guards against a malformed response that never clears `has_more`. At 100 items per page this
// still covers 500k notebooks or search hits.
const MAX_PAGES = 5000;

/** The read-only portion of Joplin's Data API used by this plugin. */
export interface JoplinDataApi {
    get(path: string[], query?: unknown): Promise<unknown>;
}

/** A note returned by the backlink candidate search. */
export interface SearchNote {
    id: string;
    title: string;
    body: string;
    parent_id: string;
}

/** A resolved note's title, parent notebook, and optionally requested body. */
export interface NoteMeta {
    title: string;
    parent_id: string;
    body: string;
}

/** The folder fields needed to expand ignored notebooks. */
export interface FolderNode {
    id: string;
    parent_id: string;
}

interface Page<T> {
    items: T[];
    has_more?: boolean;
}

/** Domain-facing read operations needed by backlink discovery. */
export interface LinkRepository {
    searchNotes(query: string): Promise<SearchNote[]>;
    getNoteBody(noteId: string): Promise<string>;
    getNoteMeta(noteId: string, includeBody?: boolean): Promise<NoteMeta>;
    getNotebookTitle(folderId: string): Promise<string>;
    listFolders(): Promise<FolderNode[]>;
}

function asRecord(value: unknown, description: string): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        throw new Error(`Joplin returned an invalid ${description}.`);
    }
    return value as Record<string, unknown>;
}

function asPage<T>(value: unknown, itemDescription: string): Page<T> {
    const record = asRecord(value, `${itemDescription} list`);
    if (!Array.isArray(record.items) || (record.has_more !== undefined && typeof record.has_more !== 'boolean')) {
        throw new Error(`Joplin returned an invalid ${itemDescription} list.`);
    }
    return record as unknown as Page<T>;
}

/**
 * Narrow read-only adapter around the Joplin Data API.
 *
 * It owns endpoint paths, requested fields, pagination, and basic response validation. Link
 * discovery, error policy, and caching remain with the calling services.
 */
export class JoplinRepository implements LinkRepository {
    public constructor(private readonly data: JoplinDataApi) {}

    public async searchNotes(query: string): Promise<SearchNote[]> {
        return this.listAll<SearchNote>(
            ['search'],
            {
                query,
                fields: ['id', 'title', 'body', 'parent_id'],
            },
            'search result'
        );
    }

    public async getNoteBody(noteId: string): Promise<string> {
        const note = asRecord(await this.data.get(['notes', noteId], { fields: ['id', 'body'] }), `note ${noteId}`);
        return typeof note.body === 'string' ? note.body : '';
    }

    public async getNoteMeta(noteId: string, includeBody = false): Promise<NoteMeta> {
        const fields = includeBody ? ['id', 'title', 'parent_id', 'body'] : ['id', 'title', 'parent_id'];
        const note = asRecord(await this.data.get(['notes', noteId], { fields }), `note ${noteId}`);
        return {
            title: typeof note.title === 'string' && note.title ? note.title : 'Untitled',
            parent_id: typeof note.parent_id === 'string' ? note.parent_id : '',
            body: typeof note.body === 'string' ? note.body : '',
        };
    }

    public async getNotebookTitle(folderId: string): Promise<string> {
        const folder = asRecord(
            await this.data.get(['folders', folderId], { fields: ['id', 'title'] }),
            `notebook ${folderId}`
        );
        return typeof folder.title === 'string' ? folder.title : '';
    }

    public async listFolders(): Promise<FolderNode[]> {
        return this.listAll<FolderNode>(
            ['folders'],
            {
                fields: ['id', 'parent_id'],
            },
            'folder'
        );
    }

    private async listAll<T>(path: string[], query: Record<string, unknown>, itemDescription: string): Promise<T[]> {
        const items: T[] = [];

        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const response = asPage<T>(
                await this.data.get(path, {
                    ...query,
                    limit: PAGE_SIZE,
                    page,
                }),
                itemDescription
            );
            items.push(...response.items);
            if (!response.has_more) return items;
        }

        throw new Error(`Joplin returned more than ${MAX_PAGES} pages of ${itemDescription}s.`);
    }
}
