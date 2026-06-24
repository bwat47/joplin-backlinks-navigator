/**
 * Host-side note/notebook metadata resolution with per-call memoization.
 *
 * Only the plugin host has Data API access, so these run there. Both the backlink and
 * outgoing-link services share them and pass their own caches so lookups are deduped within a
 * single discovery pass.
 */

import joplin from 'api';
import logger from './logger';

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
