import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('api', () => ({
    __esModule: true,
    default: { commands: { execute: vi.fn() } },
}));
vi.mock('./settings', () => ({
    loadContentScriptSettings: vi.fn(),
    loadIgnoredBacklinkNoteIdsSetting: vi.fn(),
    loadIgnoredNotebookIdsSetting: vi.fn(),
    loadShowIndicatorSetting: vi.fn(),
}));
vi.mock('./backlinksService', () => ({ countBacklinks: vi.fn(), findBacklinks: vi.fn() }));
vi.mock('./outgoingLinksService', () => ({ countOutgoingLinks: vi.fn(), findOutgoingLinks: vi.fn() }));
vi.mock('./noteMetadata', () => ({ expandIgnoredFolderIds: vi.fn() }));
vi.mock('./navigation', () => ({ openNote: vi.fn() }));

import joplin from 'api';
import { COMMAND_SHOW_BACKLINKS } from '../commandIds';
import type { Backlink } from '../types';
import { countBacklinks, findBacklinks } from './backlinksService';
import type { LinkRepository } from './joplinRepository';
import { createMessageHandler } from './messageHandler';
import { openNote } from './navigation';
import { expandIgnoredFolderIds } from './noteMetadata';
import { countOutgoingLinks, findOutgoingLinks } from './outgoingLinksService';
import { loadIgnoredBacklinkNoteIdsSetting, loadIgnoredNotebookIdsSetting, loadShowIndicatorSetting } from './settings';

const repository = {} as LinkRepository;
const NOTE_ID = 'note-1';
const LINK = { noteId: 'note-2', direction: 'in' } as Backlink;

describe('createMessageHandler', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(loadIgnoredBacklinkNoteIdsSetting).mockResolvedValue(new Set(['ignored-note']));
        vi.mocked(loadIgnoredNotebookIdsSetting).mockResolvedValue(new Set(['parent']));
        vi.mocked(expandIgnoredFolderIds).mockResolvedValue(new Set(['parent', 'child']));
    });

    it.each([null, 'getBacklinks', {}, { type: 42 }, { type: 'unknownType' }, { type: 'toString' }])(
        'ignores the unsupported message %j',
        async (message) => {
            await expect(createMessageHandler(repository)(message)).resolves.toBeUndefined();
        }
    );

    it('finds backlinks with the expanded ignore filters', async () => {
        vi.mocked(findBacklinks).mockResolvedValue([LINK]);

        const response = await createMessageHandler(repository)({ type: 'getBacklinks', noteId: NOTE_ID });

        expect(response).toEqual({ ok: true, links: [LINK] });
        expect(expandIgnoredFolderIds).toHaveBeenCalledWith(repository, new Set(['parent']));
        expect(findBacklinks).toHaveBeenCalledWith(repository, NOTE_ID, {
            ignoredNoteIds: new Set(['ignored-note']),
            ignoredFolderIds: new Set(['parent', 'child']),
        });
    });

    it('reports a failed lookup as ok: false rather than as no links', async () => {
        vi.mocked(findOutgoingLinks).mockRejectedValue(new Error('boom'));

        const response = await createMessageHandler(repository)({ type: 'getOutgoingLinks', noteId: NOTE_ID });

        expect(response).toEqual({ ok: false });
    });

    it('reports a failed filter load as ok: false', async () => {
        vi.mocked(expandIgnoredFolderIds).mockRejectedValue(new Error('folders unavailable'));

        const response = await createMessageHandler(repository)({ type: 'getBacklinks', noteId: NOTE_ID });

        expect(response).toEqual({ ok: false });
        expect(findBacklinks).not.toHaveBeenCalled();
    });

    it('shares one filter load between overlapping link requests', async () => {
        vi.mocked(findBacklinks).mockResolvedValue([LINK]);
        vi.mocked(findOutgoingLinks).mockResolvedValue([]);
        const handler = createMessageHandler(repository);

        await Promise.all([
            handler({ type: 'getBacklinks', noteId: NOTE_ID }),
            handler({ type: 'getOutgoingLinks', noteId: NOTE_ID }),
        ]);

        expect(expandIgnoredFolderIds).toHaveBeenCalledTimes(1);
        expect(findOutgoingLinks).toHaveBeenCalledWith(repository, NOTE_ID, {
            ignoredNoteIds: new Set(['ignored-note']),
            ignoredFolderIds: new Set(['parent', 'child']),
        });
    });

    it('reloads filters for a request that starts after the previous load settled', async () => {
        vi.mocked(findBacklinks).mockResolvedValue([]);
        const handler = createMessageHandler(repository);

        await handler({ type: 'getBacklinks', noteId: NOTE_ID });
        await handler({ type: 'getBacklinks', noteId: NOTE_ID });

        expect(expandIgnoredFolderIds).toHaveBeenCalledTimes(2);
    });

    it('reloads filters after a shared load fails', async () => {
        vi.mocked(findBacklinks).mockResolvedValue([]);
        vi.mocked(expandIgnoredFolderIds).mockRejectedValueOnce(new Error('folders unavailable'));
        const handler = createMessageHandler(repository);

        await expect(
            Promise.all([
                handler({ type: 'getBacklinks', noteId: NOTE_ID }),
                handler({ type: 'getOutgoingLinks', noteId: NOTE_ID }),
            ])
        ).resolves.toEqual([{ ok: false }, { ok: false }]);
        expect(expandIgnoredFolderIds).toHaveBeenCalledTimes(1);
        expect(findBacklinks).not.toHaveBeenCalled();
        expect(findOutgoingLinks).not.toHaveBeenCalled();

        await expect(handler({ type: 'getBacklinks', noteId: NOTE_ID })).resolves.toEqual({ ok: true, links: [] });
        expect(expandIgnoredFolderIds).toHaveBeenCalledTimes(2);
    });

    it('skips link discovery when the indicator is disabled', async () => {
        vi.mocked(loadShowIndicatorSetting).mockResolvedValue(false);

        const response = await createMessageHandler(repository)({ type: 'getIndicatorState', noteId: NOTE_ID });

        expect(response).toEqual({ enabled: false });
        expect(loadIgnoredNotebookIdsSetting).not.toHaveBeenCalled();
        expect(countBacklinks).not.toHaveBeenCalled();
        expect(countOutgoingLinks).not.toHaveBeenCalled();
    });

    it('counts both directions for the indicator from one filter load', async () => {
        vi.mocked(loadShowIndicatorSetting).mockResolvedValue(true);
        vi.mocked(countBacklinks).mockResolvedValue({ occurrences: 5, notes: 3 });
        vi.mocked(countOutgoingLinks).mockResolvedValue(2);

        const response = await createMessageHandler(repository)({ type: 'getIndicatorState', noteId: NOTE_ID });

        expect(response).toEqual({
            enabled: true,
            ok: true,
            counts: { backlinkOccurrences: 5, backlinkNotes: 3, outgoing: 2 },
        });
        expect(expandIgnoredFolderIds).toHaveBeenCalledTimes(1);
    });

    it('reports a failed count as an enabled indicator that is not ok', async () => {
        vi.mocked(loadShowIndicatorSetting).mockResolvedValue(true);
        vi.mocked(countBacklinks).mockResolvedValue({ occurrences: 1, notes: 1 });
        vi.mocked(countOutgoingLinks).mockRejectedValue(new Error('boom'));

        const response = await createMessageHandler(repository)({ type: 'getIndicatorState', noteId: NOTE_ID });

        expect(response).toEqual({ enabled: true, ok: false });
    });

    it('forwards openNote requests to navigation', async () => {
        const message = { type: 'openNote', noteId: NOTE_ID, anchor: 'intro', mode: 'ctrlClick' };

        await createMessageHandler(repository)(message);

        expect(openNote).toHaveBeenCalledWith(message);
    });

    it('opens the panel through the show command', async () => {
        await createMessageHandler(repository)({ type: 'openPanel' });

        expect(joplin.commands.execute).toHaveBeenCalledWith(COMMAND_SHOW_BACKLINKS);
    });
});
