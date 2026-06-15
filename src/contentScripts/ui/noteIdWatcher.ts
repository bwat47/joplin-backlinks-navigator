/**
 * Watches the Joplin note-id facet and notifies when the user switches notes.
 *
 * Runs inside the content script (rather than the main plugin) because:
 * - It only fires while CodeMirror is active.
 * - Detection is synchronous within the transaction system.
 *
 * Modified from: https://github.com/personalizedrefrigerator/joplin-plugin-diff-tool (watchForNoteIdChanges.ts)
 */

import { EditorState, Extension, Facet, Transaction } from '@codemirror/state';

type NoteIdFacet = Facet<string, string>;

/**
 * Creates an extension that calls `onNoteChange` whenever the active note id changes.
 *
 * @param noteIdFacet - The Joplin-provided note-id facet (`editorControl.joplinExtensions.noteIdFacet`).
 * @param onNoteChange - Invoked after the note id changes (e.g. to close an open panel).
 */
export function createNoteIdWatcher(noteIdFacet: NoteIdFacet, onNoteChange: () => void): Extension {
    let lastNoteId: string | null = null;

    return EditorState.transactionExtender.of((tr: Transaction) => {
        const currentId = tr.state.facet(noteIdFacet);

        // Initialize on first transaction.
        if (lastNoteId === null) {
            lastNoteId = currentId;
            return null;
        }

        if (lastNoteId !== currentId) {
            lastNoteId = currentId;
            onNoteChange();
        }

        return null;
    });
}
