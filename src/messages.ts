/**
 * Message protocol for content script ↔ plugin host communication.
 *
 * The content script runs in Joplin's CodeMirror editor context and cannot directly
 * access Joplin APIs (data store, navigation, etc.). Messages defined here are sent
 * via the postMessage bridge to the plugin host, which performs the privileged work
 * and returns a response (the value the host's onMessage handler resolves with).
 *
 * See:
 * - contentScripts/backlinksNavigator.ts - Content script that sends these messages
 * - index.ts - Plugin host that receives and processes messages
 */

import type { BacklinkItem } from './types';

/** Request the list of notes that link to `noteId`. Host responds with `BacklinkItem[]`. */
export interface GetBacklinksMessage {
    type: 'getBacklinks';
    noteId: string;
}

/** Ask the host to navigate to `noteId`. Host responds with `void`. */
export interface OpenNoteMessage {
    type: 'openNote';
    noteId: string;
}

export type ContentScriptToPluginMessage = GetBacklinksMessage | OpenNoteMessage;

/** Response returned by the host for a {@link GetBacklinksMessage}. */
export type GetBacklinksResponse = BacklinkItem[];
