import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('api/types', () => ({ ToastType: { Info: 'info' } }));
vi.mock('./settings', () => ({
    loadIgnoredNotebookIdsSetting: vi.fn(),
    setIgnoredNotebookIdsSetting: vi.fn(),
}));
vi.mock('./noteMetadata', () => ({ resolveNotebookName: vi.fn() }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));

import { toggleIgnoredNotebook } from './ignoredNotebooks';
import type { LinkRepository } from './joplinRepository';
import { resolveNotebookName } from './noteMetadata';
import { loadIgnoredNotebookIdsSetting, setIgnoredNotebookIdsSetting } from './settings';
import { showToast } from './toast';

const repository = {} as LinkRepository;

describe('toggleIgnoredNotebook', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.mocked(resolveNotebookName).mockResolvedValue('Projects');
    });

    it('does nothing without a notebook in context', async () => {
        await toggleIgnoredNotebook(repository, '');

        expect(loadIgnoredNotebookIdsSetting).not.toHaveBeenCalled();
        expect(setIgnoredNotebookIdsSetting).not.toHaveBeenCalled();
    });

    it('adds a notebook that is not ignored, lowercasing its id', async () => {
        vi.mocked(loadIgnoredNotebookIdsSetting).mockResolvedValue(new Set(['other']));

        await toggleIgnoredNotebook(repository, 'ABC');

        expect(setIgnoredNotebookIdsSetting).toHaveBeenCalledWith(new Set(['other', 'abc']));
        expect(showToast).toHaveBeenCalledWith('Ignoring links in "Projects"', 'info');
    });

    it('removes a notebook that is already ignored', async () => {
        vi.mocked(loadIgnoredNotebookIdsSetting).mockResolvedValue(new Set(['other', 'abc']));

        await toggleIgnoredNotebook(repository, 'ABC');

        expect(setIgnoredNotebookIdsSetting).toHaveBeenCalledWith(new Set(['other']));
        expect(showToast).toHaveBeenCalledWith('No longer ignoring links in "Projects"', 'info');
    });

    it('falls back to a generic name when the notebook title cannot be resolved', async () => {
        vi.mocked(loadIgnoredNotebookIdsSetting).mockResolvedValue(new Set());
        vi.mocked(resolveNotebookName).mockResolvedValue('');

        await toggleIgnoredNotebook(repository, 'abc');

        expect(showToast).toHaveBeenCalledWith('Ignoring links in "this notebook"', 'info');
    });
});
