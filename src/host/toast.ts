import joplin from 'api';
import { ToastType } from 'api/types';
import logger from '../logger';

/** Shows a toast, logging rather than throwing if Joplin can't display it. */
export async function showToast(message: string, type: ToastType = ToastType.Error): Promise<void> {
    try {
        await joplin.views.dialogs.showToast({ message, type });
    } catch (error) {
        logger.warn('Failed to show toast notification', error);
    }
}
