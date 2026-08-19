/**
 * Host-side note/notebook metadata resolution with per-call memoization.
 *
 * Only the plugin host has Data API access, so these run there. Both the backlink and
 * outgoing-link services share them and pass their own caches so lookups are deduped within a
 * single discovery pass.
 *
 * This also owns {@link expandIgnoredFolderIds}, which resolves the ignored-notebook setting
 * against the notebook tree.
 */

import joplin from 'api';
import logger from '../logger';

const FOLDER_PAGE_LIMIT = 100;

interface FolderNode {
    id: string;
    parent_id: string;
}

interface FolderListResponse {
    items: FolderNode[];
    has_more: boolean;
}

/** A resolved note's title and parent notebook id. */
export interface NoteMeta {
    title: string;
    parent_id: string;
    /** The note's body, fetched only when `resolveNoteMeta` is called with `includeBody`; '' otherwise. */
    body: string;
}

interface ResolveNoteMetaOptions {
    /** Also fetch the note `body` (used to derive an outgoing link's opening snippet). */
    includeBody?: boolean;
}

/**
 * Resolves a notebook title by id, memoizing lookups in `cache`. Returns '' on failure.
 */
export async function resolveNotebookName(parentId: string, cache: Map<string, string>): Promise<string> {
    if (!parentId) {
        return '';
    }
    const cached = cache.get(parentId);
    if (cached !== undefined) {
        return cached;
    }
    try {
        const folder = await joplin.data.get(['folders', parentId], { fields: ['id', 'title'] });
        const title = typeof folder?.title === 'string' ? folder.title : '';
        cache.set(parentId, title);
        return title;
    } catch (error) {
        logger.warn('Failed to resolve notebook name', { parentId, error });
        cache.set(parentId, '');
        return '';
    }
}

/**
 * Resolves a note's title and parent notebook id, memoizing lookups in `cache`.
 *
 * @returns The note metadata, or `null` if the note can't be fetched (e.g. a broken link).
 */
export async function resolveNoteMeta(
    noteId: string,
    cache: Map<string, NoteMeta | null>,
    options: ResolveNoteMetaOptions = {}
): Promise<NoteMeta | null> {
    const cached = cache.get(noteId);
    if (cached !== undefined) {
        return cached;
    }
    const fields = options.includeBody ? ['id', 'title', 'parent_id', 'body'] : ['id', 'title', 'parent_id'];
    try {
        const note = await joplin.data.get(['notes', noteId], { fields });
        const meta: NoteMeta = {
            title: typeof note?.title === 'string' && note.title ? note.title : 'Untitled',
            parent_id: typeof note?.parent_id === 'string' ? note.parent_id : '',
            body: typeof note?.body === 'string' ? note.body : '',
        };
        cache.set(noteId, meta);
        return meta;
    } catch (error) {
        logger.warn('Failed to resolve note metadata', { noteId, error });
        cache.set(noteId, null);
        return null;
    }
}

/** Lists every notebook id and its parent. Returns `null` if the listing fails. */
async function listFolders(): Promise<FolderNode[] | null> {
    const folders: FolderNode[] = [];
    try {
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const response: FolderListResponse = await joplin.data.get(['folders'], {
                fields: ['id', 'parent_id'],
                limit: FOLDER_PAGE_LIMIT,
                page,
            });

            if (response?.items?.length) {
                folders.push(...response.items);
            }

            hasMore = Boolean(response?.has_more);
            page += 1;
        }
    } catch (error) {
        logger.warn('Failed to list notebooks for ignored-notebook expansion', { error });
        return null;
    }

    return folders;
}

/** Indexes notebooks by parent so the tree can be walked downward. Top-level notebooks are skipped. */
function groupFoldersByParent(folders: readonly FolderNode[]): Map<string, string[]> {
    const childrenByParent = new Map<string, string[]>();

    for (const folder of folders) {
        if (!folder?.id || !folder.parent_id) {
            continue;
        }
        const siblings = childrenByParent.get(folder.parent_id);
        if (siblings) {
            siblings.push(folder.id);
        } else {
            childrenByParent.set(folder.parent_id, [folder.id]);
        }
    }

    return childrenByParent;
}

/**
 * Expands the configured ignored notebooks to include every notebook nested under them.
 *
 * Only the configured ids are stored, so the expansion happens per request rather than at save
 * time: notebooks get created and re-parented after the setting is written, and a stored expansion
 * would go stale. The cost is one folder listing, and only when the setting is non-empty.
 *
 * @param configuredIds - The notebook ids the user chose to ignore.
 * @returns Those ids plus all their descendants. Falls back to `configuredIds` alone if the folder
 *   listing fails, so a failed lookup narrows the filter rather than dropping it.
 */
export async function expandIgnoredFolderIds(configuredIds: ReadonlySet<string>): Promise<ReadonlySet<string>> {
    if (!configuredIds.size) {
        return configuredIds;
    }

    const folders = await listFolders();
    if (!folders) {
        return configuredIds;
    }

    // Breadth-first from each configured notebook. The visited set doubles as the result and keeps
    // a malformed parent cycle from looping forever.
    const childrenByParent = groupFoldersByParent(folders);
    const expanded = new Set(configuredIds);
    const queue = [...configuredIds];
    for (let index = 0; index < queue.length; index += 1) {
        for (const childId of childrenByParent.get(queue[index]) ?? []) {
            if (!expanded.has(childId)) {
                expanded.add(childId);
                queue.push(childId);
            }
        }
    }

    logger.debug('Expanded ignored notebooks', { configured: configuredIds.size, expanded: expanded.size });
    return expanded;
}
