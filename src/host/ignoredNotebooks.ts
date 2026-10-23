import { ToastType } from 'api/types';
import logger from '../logger';
import type { LinkRepository } from './joplinRepository';
import { resolveNotebookName } from './noteMetadata';
import { loadIgnoredNotebookIdsSetting, setIgnoredNotebookIdsSetting } from './settings';
import { showToast } from './toast';

/**
 * Adds or removes the right-clicked notebook from the ignore list.
 *
 * Joplin's menu items carry no per-item checked state and their labels are fixed at registration,
 * so one toggle plus a toast is the only way to show which way the switch flipped.
 *
 * @param folderId - Supplied by the folder context menu. Empty when the command is run from the
 *   command palette, where there is no notebook in context.
 */
export async function toggleIgnoredNotebook(repository: LinkRepository, folderId: string): Promise<void> {
    if (!folderId) {
        logger.debug('Ignore-notebook command invoked without a notebook');
        return;
    }

    // The setting stores lowercased ids, so match that before adding or removing.
    const notebookId = folderId.toLowerCase();
    const ignored = await loadIgnoredNotebookIdsSetting();
    const nowIgnored = !ignored.delete(notebookId);
    if (nowIgnored) {
        ignored.add(notebookId);
    }
    // Writing the setting fires onChange, which refreshes the indicator.
    await setIgnoredNotebookIdsSetting(ignored);

    const notebookName = (await resolveNotebookName(repository, folderId, new Map())) || 'this notebook';
    logger.info('Toggled ignored notebook', { folderId, nowIgnored });
    await showToast(
        nowIgnored ? `Ignoring links in "${notebookName}"` : `No longer ignoring links in "${notebookName}"`,
        ToastType.Info
    );
}
