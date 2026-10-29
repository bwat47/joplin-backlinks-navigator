/**
 * Host-side note/notebook metadata resolution with per-call memoization.
 *
 * Only the plugin host has Data API access, so these run there. Both the backlink and
 * outgoing-link services share them and pass their own caches so lookups are deduped within a
 * single discovery pass. The caches hold the lookup promise rather than its result, so concurrent
 * requests for the same id share one round trip instead of racing to fill the cache.
 *
 * This also owns {@link expandIgnoredFolderIds}, which resolves the ignored-notebook setting
 * against the notebook tree.
 */

import logger from '../logger';
import type { FolderNode, LinkRepository, NoteMeta, NoteWithBody } from './joplinRepository';

/** Notebook title lookups for one discovery pass, keyed by notebook id. */
export type NotebookNameCache = Map<string, Promise<string>>;

/** Note metadata lookups for one discovery pass, keyed by note id. `null` marks an unresolvable note. */
export type NoteMetaCache = Map<string, Promise<NoteMeta | null>>;

/**
 * Note lookups that include the body, keyed by note id. A separate type from {@link NoteMetaCache},
 * so a cache filled without bodies can't be read by a caller that needs them.
 */
export type NoteWithBodyCache = Map<string, Promise<NoteWithBody | null>>;

/** Returns the cached lookup for `key`, starting it with `load` on first use. */
function memoize<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    let pending = cache.get(key);
    if (!pending) {
        pending = load();
        cache.set(key, pending);
    }
    return pending;
}

async function fetchNotebookName(repository: LinkRepository, parentId: string): Promise<string> {
    try {
        return await repository.getNotebookTitle(parentId);
    } catch (error) {
        logger.warn('Failed to resolve notebook name', { parentId, error });
        return '';
    }
}

/** Runs a note lookup, reporting a note that can't be fetched as `null`. */
async function fetchNote<T>(noteId: string, load: () => Promise<T>): Promise<T | null> {
    try {
        return await load();
    } catch (error) {
        logger.warn('Failed to resolve note', { noteId, error });
        return null;
    }
}

/**
 * Resolves a notebook title by id, memoizing lookups in `cache`. Returns '' on failure.
 */
export async function resolveNotebookName(
    repository: LinkRepository,
    parentId: string,
    cache: NotebookNameCache
): Promise<string> {
    if (!parentId) {
        return '';
    }
    return memoize(cache, parentId, () => fetchNotebookName(repository, parentId));
}

/**
 * Resolves a note's title and parent notebook id, memoizing lookups in `cache`.
 *
 * @returns The note metadata, or `null` if the note can't be fetched (e.g. a broken link).
 */
export async function resolveNoteMeta(
    repository: LinkRepository,
    noteId: string,
    cache: NoteMetaCache
): Promise<NoteMeta | null> {
    return memoize(cache, noteId, () => fetchNote(noteId, () => repository.getNoteMeta(noteId)));
}

/**
 * Resolves a note's metadata and body (used to derive an outgoing link's opening snippet),
 * memoizing lookups in `cache`.
 *
 * @returns The note, or `null` if it can't be fetched (e.g. a broken link).
 */
export async function resolveNoteWithBody(
    repository: LinkRepository,
    noteId: string,
    cache: NoteWithBodyCache
): Promise<NoteWithBody | null> {
    return memoize(cache, noteId, () => fetchNote(noteId, () => repository.getNoteWithBody(noteId)));
}

/** Lists every notebook id and its parent. Returns `null` if the listing fails. */
async function listFolders(repository: LinkRepository): Promise<FolderNode[] | null> {
    try {
        return await repository.listFolders();
    } catch (error) {
        logger.warn('Failed to list notebooks for ignored-notebook expansion', { error });
        return null;
    }
}

/** Indexes notebooks by parent so the tree can be walked downward. Top-level notebooks are skipped. */
function groupFoldersByParent(folders: readonly FolderNode[]): Map<string, string[]> {
    const childrenByParent = new Map<string, string[]>();

    for (const folder of folders) {
        if (!folder.id || !folder.parent_id) {
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
export async function expandIgnoredFolderIds(
    repository: LinkRepository,
    configuredIds: ReadonlySet<string>
): Promise<ReadonlySet<string>> {
    if (!configuredIds.size) {
        return configuredIds;
    }

    const folders = await listFolders(repository);
    if (!folders) {
        return configuredIds;
    }

    // Breadth-first from each configured notebook. The visited set doubles as the result and keeps
    // a malformed parent cycle from looping forever.
    const childrenByParent = groupFoldersByParent(folders);
    const expanded = new Set(configuredIds);
    const queue = [...configuredIds];
    // Array iteration also visits descendants appended during the walk.
    for (const parentId of queue) {
        for (const childId of childrenByParent.get(parentId) ?? []) {
            if (!expanded.has(childId)) {
                expanded.add(childId);
                queue.push(childId);
            }
        }
    }

    logger.debug('Expanded ignored notebooks', { configured: configuredIds.size, expanded: expanded.size });
    return expanded;
}
