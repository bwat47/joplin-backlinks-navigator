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

/** Request the list of backlink occurrences that link to `noteId`. Host responds with `BacklinkItem[]`. */
export interface GetBacklinksMessage {
    type: 'getBacklinks';
    noteId: string;
}

/**
 * Sent when a note loads to drive the top-right indicator. The host checks the
 * "show indicator" setting first and only runs a backlink search when it is enabled,
 * so this is cheap when the indicator is turned off. Host responds with {@link IndicatorState}.
 */
export interface GetIndicatorStateMessage {
    type: 'getIndicatorState';
    noteId: string;
}

/** Ask the host to navigate to `noteId`. Host responds with `void`. */
export interface OpenNoteMessage {
    type: 'openNote';
    noteId: string;
}

/**
 * Ask the host to open the backlinks panel (used by the indicator click). Routing through the
 * host runs the normal command, so the panel opens with the user's configured dimensions and
 * the correct mobile flag. Host responds with `void`.
 */
export interface OpenPanelMessage {
    type: 'openPanel';
}

export type ContentScriptToPluginMessage =
    | GetBacklinksMessage
    | GetIndicatorStateMessage
    | OpenNoteMessage
    | OpenPanelMessage;

/** Response returned by the host for a {@link GetBacklinksMessage}. */
export type GetBacklinksResponse = BacklinkItem[];

/**
 * Response for a {@link GetIndicatorStateMessage}.
 * `enabled` is false when the indicator setting is off (no search was performed).
 */
export type IndicatorState = { enabled: false } | { enabled: true; backlinks: BacklinkItem[] };
