/** Direction of a link relative to the current note. */
export type LinkDirection = 'in' | 'out';

/**
 * A single link related to the currently open note.
 *
 * - `direction: 'in'` (backlink) — one occurrence of another note linking to the current note.
 *   `noteId` is the linking note; `title`/`notebookName`/`snippet`/`section` describe that note
 *   and the occurrence's line; `occurrenceIndex`/`occurrenceCount` enumerate the occurrences
 *   inside the linking note (used to scroll to the right one).
 * - `direction: 'out'` (outgoing link) — one distinct destination the current note links to,
 *   where a destination is a target note plus an optional anchor: `[a](:/id)` and
 *   `[b](:/id#some-anchor)` are separate rows, but repeats of either are deduped. `noteId` is the
 *   target note and `anchor` the fragment it points at — a heading slug or an explicit HTML anchor
 *   id (empty when the link targets the note as a whole); `title`/`notebookName` describe the note;
 *   `snippet` previews the opening of the linked note (or of the anchored section/line) and
 *   `section` names the anchored heading, the HTML anchor's text, or the raw slug when the anchor
 *   resolves to nothing (empty without an anchor); `occurrenceIndex` is always 0 and
 *   `occurrenceCount` is the number of links to that destination.
 */
export interface LinkItem {
    /** Whether this is an inbound (backlink) or outbound (outgoing) link. */
    direction: LinkDirection;
    /** Unique row ID for this link. */
    id: string;
    /** ID of the linked note (used for navigation via `:/<id>`). */
    noteId: string;
    /**
     * Anchor fragment this row navigates to (`:/<id>#<anchor>`) — a heading slug or an explicit
     * HTML anchor id; empty when the row targets the note as a whole. Only set for outgoing links.
     */
    anchor: string;
    /** Zero-based occurrence index for this link inside its source note. */
    occurrenceIndex: number;
    /** Number of link occurrences this row represents. */
    occurrenceCount: number;
    /** Title of the linked note. */
    title: string;
    /** Title of the linked note's parent notebook. */
    notebookName: string;
    /** Text of the nearest heading the link sits under (no `#`); empty if none. */
    section: string;
    /** Cleaned prose of the body line that contains the link occurrence (no link URLs/markdown). */
    snippet: string;
}

/**
 * Link tallies for the current note, resolved without building {@link LinkItem} rows.
 *
 * The indicator badge only needs numbers, so the host counts links instead of resolving snippets,
 * notebook names, and anchors for every row (see `countBacklinks`/`countOutgoingLinks`). Both
 * backlink figures are carried because the display policy that picks between them lives in the
 * content script, which owns the current preview settings — see `getDisplayCounts`.
 */
export interface LinkCounts {
    /** Total inbound link occurrences, matching one backlink row each. */
    backlinkOccurrences: number;
    /** Distinct notes linking here — what title-only backlink mode collapses those rows to. */
    backlinkNotes: number;
    /** Distinct outgoing destinations (note + optional anchor), excluding broken links. */
    outgoing: number;
}

export const EMPTY_LINK_COUNTS: LinkCounts = {
    backlinkOccurrences: 0,
    backlinkNotes: 0,
    outgoing: 0,
};

export interface PanelDimensions {
    /** Panel width in pixels. */
    width: number;
    /**
     * Panel max height as a percentage of the editor viewport — the same unit the user's setting
     * uses, carried unchanged to the CSS that consumes it, so it is only ever validated in one
     * unit system. See `panelDimensions.ts`.
     */
    maxHeightPercentage: number;
}

export type LinkPreviewMode = 'title' | 'titleSnippet' | 'titleSnippetHeading';

/**
 * Type guard for a valid {@link LinkPreviewMode}. Shared by the host-side settings loader and the
 * content-script payload validator so both agree on which modes are allowed.
 *
 * @param allowHeading - Whether `'titleSnippetHeading'` is accepted (outgoing links have no
 *   enclosing heading to show, so that mode is rejected for them).
 */
export function isLinkPreviewMode(value: unknown, allowHeading: boolean): value is LinkPreviewMode {
    return value === 'title' || value === 'titleSnippet' || (allowHeading && value === 'titleSnippetHeading');
}

export interface LinkPreviewSettings {
    in: LinkPreviewMode;
    out: LinkPreviewMode;
}

export interface PanelSettings {
    dimensions: PanelDimensions;
    preview: LinkPreviewSettings;
}

export interface ContentScriptSettings {
    panel: PanelSettings;
    showIndicator: boolean;
}

export type BacklinkOpenBehavior = 'newWindow' | 'newTab';

export const DEFAULT_PANEL_DIMENSIONS: PanelDimensions = {
    width: 360,
    maxHeightPercentage: 75,
};

export const DEFAULT_LINK_PREVIEW_SETTINGS: LinkPreviewSettings = {
    in: 'titleSnippet',
    out: 'titleSnippet',
};
