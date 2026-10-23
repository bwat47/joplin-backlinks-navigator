import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('api', () => ({
    __esModule: true,
    default: { commands: { execute: vi.fn() } },
}));
vi.mock('./settings', () => ({
    loadCtrlClickBehaviorSetting: vi.fn(),
    loadCtrlEnterBehaviorSetting: vi.fn(),
    loadMiddleClickBehaviorSetting: vi.fn(),
}));
vi.mock('./toast', () => ({ showToast: vi.fn() }));

import joplin from 'api';
import type { AlternateOpenMode } from '../messages';
import { openNote } from './navigation';
import { loadCtrlClickBehaviorSetting, loadCtrlEnterBehaviorSetting, loadMiddleClickBehaviorSetting } from './settings';
import { showToast } from './toast';

const mockExecute = vi.mocked(joplin.commands.execute);
const NOTE_ID = 'note-1';

describe('openNote', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('opens in the current window when no gesture mode is given', async () => {
        await openNote({ type: 'openNote', noteId: NOTE_ID });

        expect(mockExecute).toHaveBeenCalledWith('openItem', `:/${NOTE_ID}`);
    });

    it('keeps the anchor when opening in the current window', async () => {
        await openNote({ type: 'openNote', noteId: NOTE_ID, anchor: 'intro' });

        expect(mockExecute).toHaveBeenCalledWith('openItem', `:/${NOTE_ID}#intro`);
    });

    it.each([
        ['ctrlClick', loadCtrlClickBehaviorSetting],
        ['ctrlEnter', loadCtrlEnterBehaviorSetting],
        ['middleClick', loadMiddleClickBehaviorSetting],
    ] as const)('reads the %s behavior setting', async (mode, loader) => {
        vi.mocked(loader).mockResolvedValue('newWindow');

        await openNote({ type: 'openNote', noteId: NOTE_ID, anchor: 'intro', mode });

        expect(loader).toHaveBeenCalledTimes(1);
        expect(mockExecute).toHaveBeenCalledWith('openNoteInNewWindow', NOTE_ID);
    });

    it('treats an unknown mode as the current window without reading Object.prototype', async () => {
        await openNote({ type: 'openNote', noteId: NOTE_ID, mode: 'toString' as AlternateOpenMode });

        expect(mockExecute).toHaveBeenCalledWith('openItem', `:/${NOTE_ID}`);
    });

    it('opens in a Note Tabs tab', async () => {
        vi.mocked(loadMiddleClickBehaviorSetting).mockResolvedValue('newTab');

        await openNote({ type: 'openNote', noteId: NOTE_ID, mode: 'middleClick' });

        expect(mockExecute).toHaveBeenCalledWith('tabsPinNote', [NOTE_ID]);
    });

    it('shows a toast when Note Tabs is unavailable', async () => {
        vi.mocked(loadMiddleClickBehaviorSetting).mockResolvedValue('newTab');
        mockExecute.mockRejectedValue(new Error('unknown command'));

        await openNote({ type: 'openNote', noteId: NOTE_ID, mode: 'middleClick' });

        expect(showToast).toHaveBeenCalledWith('Opening backlinks in new tabs requires the Note Tabs plugin.');
    });

    it('shows a toast when a new window fails to open', async () => {
        vi.mocked(loadCtrlClickBehaviorSetting).mockResolvedValue('newWindow');
        mockExecute.mockRejectedValue(new Error('failed'));

        await openNote({ type: 'openNote', noteId: NOTE_ID, mode: 'ctrlClick' });

        expect(showToast).toHaveBeenCalledWith('Failed to open backlink in new window');
    });
});
