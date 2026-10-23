/**
 * Answers requests from the content script (see messages.ts for the protocol).
 *
 * Link requests load the user's exclusions once and hand them to the link services; failures are
 * reported in the response rather than as empty results, so the panel can show an error.
 */

import joplin from 'api';
import { COMMAND_SHOW_BACKLINKS } from '../commandIds';
import logger from '../logger';
import type { IndicatorState, LinksResponse, MessageOf, Protocol, ResponseFor } from '../messages';
import type { LinkFilters, LinkItem } from '../types';
import { countBacklinks, findBacklinks } from './backlinksService';
import type { LinkRepository } from './joplinRepository';
import { openNote } from './navigation';
import { expandIgnoredFolderIds } from './noteMetadata';
import { countOutgoingLinks, findOutgoingLinks } from './outgoingLinksService';
import {
    loadContentScriptSettings,
    loadIgnoredBacklinkNoteIdsSetting,
    loadIgnoredNotebookIdsSetting,
    loadShowIndicatorSetting,
} from './settings';

/**
 * Reads the configured exclusions and resolves the ignored notebooks against the notebook tree.
 *
 * Shared by every discovery call a request feeds, and by overlapping requests (see
 * `createMessageHandler`), so neither the indicator's two counters nor the panel's two tabs each
 * pay for the folder listing.
 */
async function loadLinkFilters(repository: LinkRepository): Promise<LinkFilters> {
    const [ignoredNoteIds, configuredFolderIds] = await Promise.all([
        loadIgnoredBacklinkNoteIdsSetting(),
        loadIgnoredNotebookIdsSetting(),
    ]);
    return { ignoredNoteIds, ignoredFolderIds: await expandIgnoredFolderIds(repository, configuredFolderIds) };
}

/**
 * Runs a link lookup and reports a failure in the response instead of as an empty list, so the
 * panel can show an error rather than "no links".
 */
async function toLinksResponse(
    description: string,
    noteId: string,
    load: () => Promise<LinkItem[]>
): Promise<LinksResponse> {
    try {
        return { ok: true, links: await load() };
    } catch (error) {
        logger.error(`Failed to load ${description}`, { noteId, error });
        return { ok: false };
    }
}

async function loadIndicatorState(
    repository: LinkRepository,
    noteId: string,
    loadFilters: () => Promise<LinkFilters>
): Promise<IndicatorState> {
    // Honor the setting before doing any link discovery.
    if (!(await loadShowIndicatorSetting())) {
        return { enabled: false };
    }
    // The badge only renders counts, so count links instead of resolving rows: this skips the
    // snippet, notebook, and anchor work — including a body fetch and markdown parse per outgoing
    // target — on every note open.
    try {
        const filters = await loadFilters();
        const [backlinks, outgoing] = await Promise.all([
            countBacklinks(repository, noteId, filters),
            countOutgoingLinks(repository, noteId, filters),
        ]);
        return {
            enabled: true,
            ok: true,
            counts: {
                backlinkOccurrences: backlinks.occurrences,
                backlinkNotes: backlinks.notes,
                outgoing,
            },
        };
    } catch (error) {
        logger.error('Failed to count links for the indicator', { noteId, error });
        return { enabled: true, ok: false };
    }
}

/**
 * Builds the host side of the bridge, for `joplin.contentScripts.onMessage`. It resolves with the
 * handler's response, or with undefined for a message it doesn't recognize.
 */
export function createMessageHandler(repository: LinkRepository): (message: unknown) => Promise<unknown> {
    // Opening the panel sends `getBacklinks` and `getOutgoingLinks` together, so share one filter
    // load between requests that overlap. Only the in-flight load is shared, so a later request
    // still sees setting and notebook changes.
    let pendingFilters: Promise<LinkFilters> | null = null;
    const loadSharedLinkFilters = (): Promise<LinkFilters> => {
        pendingFilters ??= loadLinkFilters(repository).finally(() => {
            pendingFilters = null;
        });
        return pendingFilters;
    };

    const handlers: { [K in keyof Protocol]: (message: MessageOf<K>) => Promise<ResponseFor<K>> } = {
        getBacklinks: (message) =>
            toLinksResponse('backlinks', message.noteId, async () =>
                findBacklinks(repository, message.noteId, await loadSharedLinkFilters())
            ),
        getOutgoingLinks: (message) =>
            toLinksResponse('outgoing links', message.noteId, async () =>
                findOutgoingLinks(repository, message.noteId, await loadSharedLinkFilters())
            ),
        getContentScriptSettings: () => loadContentScriptSettings(),
        getIndicatorState: (message) => loadIndicatorState(repository, message.noteId, loadSharedLinkFilters),
        openNote: (message) => openNote(message),
        openPanel: async () => {
            await joplin.commands.execute(COMMAND_SHOW_BACKLINKS);
        },
    };

    // Indexing `handlers` by `message.type` gives a union of handlers that the message union can't be
    // passed to directly; expressing the call through `K` lets TypeScript treat it as correlated.
    const dispatch = <K extends keyof Protocol>(message: MessageOf<K>): Promise<ResponseFor<K>> =>
        handlers[message.type](message);

    return async (message) => {
        // An own-property check rather than `in`, so a type such as 'toString' can't reach
        // Object.prototype. Only `type` is checked; the handlers trust the remaining fields.
        if (
            typeof message !== 'object' ||
            message === null ||
            !('type' in message) ||
            typeof message.type !== 'string' ||
            !Object.prototype.hasOwnProperty.call(handlers, message.type)
        ) {
            logger.warn('Received unsupported message from content script', message);
            return;
        }
        return dispatch(message as MessageOf<keyof Protocol>);
    };
}
