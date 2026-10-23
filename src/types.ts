/** Direction of a link relative to the current note. */
export type LinkDirection = 'in' | 'out';

/** The fields every panel row shares, whichever direction it points. */
interface LinkItemBase {
    /** Unique row ID for this link. */
    id: string;
    /** ID of the linked note (used for navigation via `:/<id>`). */
    noteId: string;
    /** Title of the linked note. */
    title: string;
    /** Title of the linked note's parent notebook. */
    notebookName: string;
    /** Label shown under the title when the preview mode or the row asks for one; empty if none. */
    section: string;
    /** Cleaned prose preview (no link URLs/markdown). */
    snippet: string;
}

/**
 * One occurrence of another note linking to the current note. `noteId` is the linking note,
 * `section` is the nearest heading above the occurrence, and `snippet` is the occurrence's line.
 */
export interface Backlink extends LinkItemBase {
    direction: 'in';
    /** Zero-based index of this occurrence among the linking note's links here (used to scroll to it). */
    occurrenceIndex: number;
    /** Number of links the linking note has to the current note. */
    occurrenceCount: number;
}

/**
 * One distinct destination the current note links to: a target note plus an optional anchor.
 * `[a](:/id)` and `[b](:/id#some-anchor)` are separate rows; repeats of either are deduped.
 * `snippet` previews the opening of the linked note, or of the anchored section or line; `section`
 * names the anchored heading, the HTML anchor's text, or the raw slug when the anchor resolves to
 * nothing (empty without an anchor).
 */
export interface OutgoingLink extends LinkItemBase {
    direction: 'out';
    /**
     * Anchor fragment this row navigates to (`:/<id>#<anchor>`) — a heading slug or an explicit
     * HTML anchor id; empty when the row targets the note as a whole.
     */
    anchor: string;
    /**
     * The target note is in the trash. Unlike a trashed backlink source (which Joplin's search
     * never returns), a link to a trashed note is still a link in the current note's body — one the
     * user may want to clean up — so the row is kept and marked instead. `notebookName` is empty:
     * Joplin keeps the original `parent_id` on trashed notes, so that folder would be misleading.
     */
    isTrashed: boolean;
}

/** A single link related to the currently open note, discriminated by `direction`. */
export type LinkItem = Backlink | OutgoingLink;

/**
 * User-configured exclusions applied to both link directions and to the indicator counts, so the
 * badge stays in step with the panel.
 *
 * Filtering applies to *results*, not to the note being viewed: a note that lives in an ignored
 * notebook still shows its own backlinks and outgoing links.
 */
export interface LinkFilters {
    /** Notes to omit from results, by id. */
    ignoredNoteIds?: ReadonlySet<string>;
    /**
     * Notebooks whose notes are omitted from results, by id. Already expanded to include
     * sub-notebooks — see `expandIgnoredFolderIds` in `host/noteMetadata.ts`.
     */
    ignoredFolderIds?: ReadonlySet<string>;
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
