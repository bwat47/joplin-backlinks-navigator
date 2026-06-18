/** Direction of a link relative to the current note. */
export type LinkDirection = 'in' | 'out';

/**
 * A single link related to the currently open note.
 *
 * - `direction: 'in'` (backlink) — one occurrence of another note linking to the current note.
 *   `noteId` is the linking note; `title`/`notebookName`/`snippet`/`section` describe that note
 *   and the occurrence's line; `occurrenceIndex`/`occurrenceCount` enumerate the occurrences
 *   inside the linking note (used to scroll to the right one).
 * - `direction: 'out'` (outgoing link) — one distinct note that the current note links to (deduped).
 *   `noteId` is the target note; `title`/`notebookName` describe it; `snippet`/`section` describe the
 *   first occurrence in the current note; `occurrenceIndex` is always 0 and `occurrenceCount` is the
 *   number of links to that target.
 */
export interface LinkItem {
    /** Whether this is an inbound (backlink) or outbound (outgoing) link. */
    direction: LinkDirection;
    /** Unique row ID for this link. */
    id: string;
    /** ID of the linked note (used for navigation via `:/<id>`). */
    noteId: string;
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

export interface PanelDimensions {
    width: number;
    maxHeightRatio: number;
}

export type LinkPreviewMode = 'title' | 'titleSnippet' | 'titleSnippetHeading';

export interface LinkPreviewSettings {
    in: LinkPreviewMode;
    out: LinkPreviewMode;
}

export interface PanelSettings {
    dimensions: PanelDimensions;
    preview: LinkPreviewSettings;
}

export type BacklinkOpenBehavior = 'newWindow' | 'newTab';

export const DEFAULT_PANEL_DIMENSIONS: PanelDimensions = {
    width: 360,
    // Represents 75% of the editor viewport height
    maxHeightRatio: 0.75,
};

export const DEFAULT_LINK_PREVIEW_SETTINGS: LinkPreviewSettings = {
    in: 'titleSnippet',
    out: 'title',
};
