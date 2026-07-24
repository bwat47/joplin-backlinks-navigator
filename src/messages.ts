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

import type { ContentScriptSettings, LinkItem } from './types';

/** Request the list of backlink occurrences that link to `noteId`. Host responds with `LinkItem[]`. */
interface GetBacklinksMessage {
    type: 'getBacklinks';
    noteId: string;
}

/** Request the list of distinct notes that `noteId` links to. Host responds with `LinkItem[]`. */
interface GetOutgoingLinksMessage {
    type: 'getOutgoingLinks';
    noteId: string;
}

/**
 * Sent when a note loads to drive the top-right indicator. The host checks the
 * "show indicator" setting first and only runs link discovery when it is enabled,
 * so this is cheap when the indicator is turned off. Host responds with {@link IndicatorState}.
 */
interface GetIndicatorStateMessage {
    type: 'getIndicatorState';
    noteId: string;
}

/** Request settings consumed by the editor content script. Host responds with {@link ContentScriptSettings}. */
interface GetContentScriptSettingsMessage {
    type: 'getContentScriptSettings';
}

/**
 * Ask the host to navigate to `noteId`, optionally to the heading named by `anchor` (Joplin's
 * `openItem` accepts the `:/<id>#<anchor>` form). Host responds with `void`.
 */
interface OpenNoteMessage {
    type: 'openNote';
    noteId: string;
    anchor?: string;
    mode?: 'ctrlClick' | 'ctrlEnter';
}

/**
 * Ask the host to open the backlinks panel (used by the indicator click). Routing through the
 * host runs the normal command, so the panel opens with the user's configured dimensions and
 * the correct mobile flag. Host responds with `void`.
 */
interface OpenPanelMessage {
    type: 'openPanel';
}

export type ContentScriptToPluginMessage =
    | GetBacklinksMessage
    | GetOutgoingLinksMessage
    | GetIndicatorStateMessage
    | GetContentScriptSettingsMessage
    | OpenNoteMessage
    | OpenPanelMessage;

/** Response returned by the host for a {@link GetBacklinksMessage}. */
export type GetBacklinksResponse = LinkItem[];

/** Response returned by the host for a {@link GetOutgoingLinksMessage}. */
export type GetOutgoingLinksResponse = LinkItem[];

/** Response returned by the host for a {@link GetContentScriptSettingsMessage}. */
export type GetContentScriptSettingsResponse = ContentScriptSettings;

/**
 * Response for a {@link GetIndicatorStateMessage}.
 * `enabled` is false when the indicator setting is off (no search was performed); otherwise it
 * carries raw link rows for both directions so the content script can apply the current display policy.
 */
export type IndicatorState = { enabled: false } | { enabled: true; backlinks: LinkItem[]; outgoing: LinkItem[] };
