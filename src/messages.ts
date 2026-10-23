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

import type { ContentScriptSettings, LinkCounts, LinkItem } from './types';

/**
 * Navigation gestures that open a link somewhere other than the current note. Each maps to its own
 * user-configurable open behavior, resolved host-side (see `resolveOpenNoteMode` in index.ts).
 */
export type AlternateOpenMode = 'ctrlClick' | 'ctrlEnter' | 'middleClick';

/**
 * Every message the content script can send, keyed by `type`, with the request fields it carries
 * and the response the host resolves with. The message and response types below derive from this.
 */
export interface Protocol {
    /** Request the list of backlink occurrences that link to `noteId`. */
    getBacklinks: { request: { noteId: string }; response: LinksResponse };
    /** Request the list of distinct notes that `noteId` links to. */
    getOutgoingLinks: { request: { noteId: string }; response: LinksResponse };
    /**
     * Sent when a note loads to drive the top-right indicator. The host checks the
     * "show indicator" setting first and only runs link discovery when it is enabled,
     * so this is cheap when the indicator is turned off.
     */
    getIndicatorState: { request: { noteId: string }; response: IndicatorState };
    /** Request settings consumed by the editor content script. */
    getContentScriptSettings: { request: Record<never, never>; response: ContentScriptSettings };
    /**
     * Ask the host to navigate to `noteId`, optionally to the heading named by `anchor` (Joplin's
     * `openItem` accepts the `:/<id>#<anchor>` form).
     */
    openNote: { request: { noteId: string; anchor?: string; mode?: AlternateOpenMode }; response: void };
    /**
     * Ask the host to open the backlinks panel (used by the indicator click). Routing through the
     * host runs the normal command, so the panel opens with the user's configured dimensions and
     * the correct mobile flag.
     */
    openPanel: { request: Record<never, never>; response: void };
}

export type MessageOf<K extends keyof Protocol> = { [P in K]: { type: P } & Protocol[P]['request'] }[K];

export type ResponseFor<K extends keyof Protocol> = Protocol[K]['response'];

/**
 * Response returned by the host for `getBacklinks` and `getOutgoingLinks`.
 *
 * A failed lookup is reported as `ok: false` rather than as an empty list, so the panel can tell
 * "no links" from "couldn't load links". The host logs the cause; the content script owns the
 * user-facing message.
 */
export type LinksResponse = { ok: true; links: LinkItem[] } | { ok: false };

/**
 * Response for `getIndicatorState`.
 *
 * `enabled` is false when the indicator setting is off (no search was performed). Otherwise `ok`
 * says whether counting succeeded and, if so, the state carries {@link LinkCounts}. The badge shows
 * numbers, so the host counts links rather than resolving full rows for them. Both backlink tallies
 * are sent because the display policy that chooses between them depends on the content script's
 * current preview settings.
 */
export type IndicatorState =
    { enabled: false } | { enabled: true; ok: true; counts: LinkCounts } | { enabled: true; ok: false };
