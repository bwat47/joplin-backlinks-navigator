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

import type { LinkItem, LinkPreviewMode } from './types';

/** Request the list of backlink occurrences that link to `noteId`. Host responds with `LinkItem[]`. */
export interface GetBacklinksMessage {
    type: 'getBacklinks';
    noteId: string;
}

/** Request the list of distinct notes that `noteId` links to. Host responds with `LinkItem[]`. */
export interface GetOutgoingLinksMessage {
    type: 'getOutgoingLinks';
    noteId: string;
}

/**
 * Sent when a note loads to drive the top-right indicator. The host checks the
 * "show indicator" setting first and only runs link discovery when it is enabled,
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
    mode?: 'ctrlClick' | 'ctrlEnter';
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
    | GetOutgoingLinksMessage
    | GetIndicatorStateMessage
    | OpenNoteMessage
    | OpenPanelMessage;

/** Response returned by the host for a {@link GetBacklinksMessage}. */
export type GetBacklinksResponse = LinkItem[];

/** Response returned by the host for a {@link GetOutgoingLinksMessage}. */
export type GetOutgoingLinksResponse = LinkItem[];

/**
 * Response for a {@link GetIndicatorStateMessage}.
 * `enabled` is false when the indicator setting is off (no search was performed); otherwise it
 * carries both link directions so the badge can show both counts, plus the backlink preview mode
 * so the badge can match the panel's title-only collapsing before the panel has ever been opened
 * (the content script otherwise only learns the preview mode when the panel command first runs).
 */
export type IndicatorState =
    | { enabled: false }
    | { enabled: true; backlinks: LinkItem[]; outgoing: LinkItem[]; backlinkPreviewMode: LinkPreviewMode };
