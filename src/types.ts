/**
 * A note that links to the currently open note.
 */
export interface BacklinkItem {
    /** ID of the linking note (used for navigation via `:/<id>`). */
    id: string;
    /** Title of the linking note. */
    title: string;
    /** Title of the linking note's parent notebook. */
    notebookName: string;
    /** Trimmed text of the first body line that contains the link. */
    snippet: string;
}

export interface PanelDimensions {
    width: number;
    maxHeightRatio: number;
}

export const DEFAULT_PANEL_DIMENSIONS: PanelDimensions = {
    width: 360,
    // Represents 75% of the editor viewport height
    maxHeightRatio: 0.75,
};
