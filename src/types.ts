/**
 * A single occurrence of a note linking to the currently open note.
 */
export interface BacklinkItem {
    /** Unique row ID for this backlink occurrence. */
    id: string;
    /** ID of the linking note (used for navigation via `:/<id>`). */
    noteId: string;
    /** Zero-based occurrence index for this target note link inside the linking note. */
    occurrenceIndex: number;
    /** Number of target note link occurrences inside the linking note. */
    occurrenceCount: number;
    /** Title of the linking note. */
    title: string;
    /** Title of the linking note's parent notebook. */
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

export type CtrlClickBehavior = 'newWindow' | 'newTab';

export const DEFAULT_PANEL_DIMENSIONS: PanelDimensions = {
    width: 360,
    // Represents 75% of the editor viewport height
    maxHeightRatio: 0.75,
};
