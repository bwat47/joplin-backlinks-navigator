const PAGE_SIZE = 100;
// A malformed `has_more` that never clears would page forever. 50k sits past any plausible vault:
// every note in a very large collection linking one hub note is still under it, and a notebook count
// anywhere near it is absurd. Reaching it means the response is wrong, not that the vault is big.
const MAX_ITEMS = 50_000;
const MAX_PAGES = MAX_ITEMS / PAGE_SIZE;

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
    /** Fetched only when the caller asks for it via `includeBody`; '' otherwise. */
    body: string;
}

/** The folder fields needed to expand ignored notebooks. */
export interface FolderNode {
    id: string;
    parent_id: string;
}

interface Page {
    items: unknown[];
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

// Asserting coercions: a violation means the response envelope itself is wrong, so they throw.

function asRecord(value: unknown, description: string): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        throw new Error(`Joplin returned an invalid ${description}.`);
    }
    return value as Record<string, unknown>;
}

function asPage(value: unknown, itemDescription: string): Page {
    const record = asRecord(value, `${itemDescription} list`);
    if (!Array.isArray(record.items) || (record.has_more !== undefined && typeof record.has_more !== 'boolean')) {
        throw new Error(`Joplin returned an invalid ${itemDescription} list.`);
    }
    return { items: record.items, has_more: record.has_more as boolean | undefined };
}

// Total coercions: one odd item shouldn't fail a whole listing, so these never throw. A field
// Joplin didn't return becomes '', which the callers already treat as "not a usable row".

function fieldsOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** Joplin permits empty note titles; every surface renders those as "Untitled". */
function noteTitle(value: unknown): string {
    return text(value) || 'Untitled';
}

function toSearchNote(value: unknown): SearchNote {
    const note = fieldsOf(value);
    return {
        id: text(note.id),
        title: noteTitle(note.title),
        body: text(note.body),
        parent_id: text(note.parent_id),
    };
}

function toFolderNode(value: unknown): FolderNode {
    const folder = fieldsOf(value);
    return { id: text(folder.id), parent_id: text(folder.parent_id) };
}

/**
 * Narrow read-only adapter around the Joplin Data API.
 *
 * It owns endpoint paths, requested fields, pagination, and response normalization — including the
 * "Untitled" fallback for empty note titles, so every row-building caller agrees on it. Link
 * discovery, error policy, and caching remain with the calling services.
 */
export class JoplinRepository implements LinkRepository {
    public constructor(private readonly data: JoplinDataApi) {}

    public async searchNotes(query: string): Promise<SearchNote[]> {
        return this.listAll(
            ['search'],
            {
                query,
                fields: ['id', 'title', 'body', 'parent_id'],
            },
            'search result',
            toSearchNote
        );
    }

    public async getNoteBody(noteId: string): Promise<string> {
        const note = asRecord(await this.data.get(['notes', noteId], { fields: ['id', 'body'] }), `note ${noteId}`);
        return text(note.body);
    }

    public async getNoteMeta(noteId: string, includeBody = false): Promise<NoteMeta> {
        const fields = includeBody ? ['id', 'title', 'parent_id', 'body'] : ['id', 'title', 'parent_id'];
        const note = asRecord(await this.data.get(['notes', noteId], { fields }), `note ${noteId}`);
        return {
            title: noteTitle(note.title),
            parent_id: text(note.parent_id),
            body: text(note.body),
        };
    }

    public async getNotebookTitle(folderId: string): Promise<string> {
        const folder = asRecord(
            await this.data.get(['folders', folderId], { fields: ['id', 'title'] }),
            `notebook ${folderId}`
        );
        // Unlike a note title, an empty notebook name means "don't render it" — see resolveNotebookName.
        return text(folder.title);
    }

    public async listFolders(): Promise<FolderNode[]> {
        return this.listAll(
            ['folders'],
            {
                fields: ['id', 'parent_id'],
            },
            'folder',
            toFolderNode
        );
    }

    private async listAll<T>(
        path: string[],
        query: Record<string, unknown>,
        itemDescription: string,
        toItem: (value: unknown) => T
    ): Promise<T[]> {
        const items: T[] = [];

        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const response = asPage(
                await this.data.get(path, {
                    ...query,
                    limit: PAGE_SIZE,
                    page,
                }),
                itemDescription
            );
            // The canonical runaway: more pages promised, none delivered. Fail here rather than
            // walking to MAX_PAGES for an answer that is already known to be wrong.
            if (response.has_more && !response.items.length) {
                throw new Error(`Joplin reported more ${itemDescription}s but returned none.`);
            }
            items.push(...response.items.map(toItem));
            if (!response.has_more) return items;
        }

        throw new Error(`Joplin returned more than ${MAX_ITEMS} ${itemDescription}s.`);
    }
}
