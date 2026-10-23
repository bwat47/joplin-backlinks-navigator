/**
 * Opens a note on behalf of the content script, in the current window, a new window, or a Note
 * Tabs tab depending on the gesture and its configured behavior.
 */

import joplin from 'api';
import logger from '../logger';
import type { AlternateOpenMode, MessageOf } from '../messages';
import type { BacklinkOpenBehavior } from '../types';
import { loadCtrlClickBehaviorSetting, loadCtrlEnterBehaviorSetting, loadMiddleClickBehaviorSetting } from './settings';
import { showToast } from './toast';

type ResolvedOpenNoteMode = 'current' | BacklinkOpenBehavior;

/** Each alternate gesture reads its own behavior setting. */
const ALTERNATE_MODE_LOADERS: Record<AlternateOpenMode, () => Promise<BacklinkOpenBehavior>> = {
    ctrlClick: loadCtrlClickBehaviorSetting,
    ctrlEnter: loadCtrlEnterBehaviorSetting,
    middleClick: loadMiddleClickBehaviorSetting,
};

async function resolveOpenNoteMode(mode: AlternateOpenMode | undefined): Promise<ResolvedOpenNoteMode> {
    // Own-property check, as in the message dispatcher, so an unexpected mode can't reach Object.prototype.
    if (!mode || !Object.prototype.hasOwnProperty.call(ALTERNATE_MODE_LOADERS, mode)) {
        return 'current';
    }
    return ALTERNATE_MODE_LOADERS[mode]();
}

/**
 * Handles an `openNote` request.
 *
 * The anchor (a heading slug to land on) is only honored in the current window: the new-window and
 * Note Tabs commands take a note id alone, so those just open the note.
 */
export async function openNote(request: MessageOf<'openNote'>): Promise<void> {
    const { noteId, anchor } = request;
    const mode = await resolveOpenNoteMode(request.mode);
    switch (mode) {
        case 'current':
            await joplin.commands.execute('openItem', anchor ? `:/${noteId}#${anchor}` : `:/${noteId}`);
            return;
        case 'newWindow':
            try {
                await joplin.commands.execute('openNoteInNewWindow', noteId);
                logger.debug('Opened backlink in new window', { noteId });
            } catch (error) {
                logger.error('Failed to open backlink in new window', { noteId, error });
                await showToast('Failed to open backlink in new window');
            }
            return;
        case 'newTab':
            try {
                await joplin.commands.execute('tabsPinNote', [noteId]);
                logger.debug('Opened backlink in Note Tabs tab', { noteId });
            } catch (error) {
                logger.error('Failed to open backlink in Note Tabs tab', { noteId, error });
                await showToast('Opening backlinks in new tabs requires the Note Tabs plugin.');
            }
            return;
        default:
            logger.warn('Received unsupported backlink open mode', mode);
    }
}
