/**
 * Scrolls a just-loaded note to the spot a selected panel row stands for.
 *
 * The navigation itself is performed by the plugin host; this module only handles what happens in
 * the editor once the target note's content appears.
 *
 * See:
 * - ../panelController.ts - records the pending scroll before navigating away
 */

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { NavigationTarget } from '../../types';
import { resolveNavigationTarget } from './navigationTarget';
import logger from '../../logger';
import { setReferenceHighlightEffect } from './referenceHighlight';
import type { TextRange } from './textRange';

/** Host-resolved target to apply after its note loads in the reused editor. */
export interface PendingScroll {
    targetNoteId: string;
    navigationTarget: NavigationTarget;
}

const MAX_ATTEMPTS = 15;
const RETRY_DELAY_MS = 80;
// Joplin restores its own cursor/scroll position shortly after a note loads; re-assert after that.
const REASSERT_DELAY_MS = 150;

/**
 * Scrolls the (just-loaded) target note to the spot the selected row stands for.
 * The note content may not be present the instant the id changes, so retry briefly.
 *
 * @param resolveNoteId - Reads the editor's current note id, so a scroll is abandoned when the
 *   user navigates away again before the content settles.
 */
export function scrollToPendingTarget(
    view: EditorView,
    target: PendingScroll,
    resolveNoteId: () => string | null
): void {
    let attempt = 0;
    const doScroll = (highlightRange: TextRange): void => {
        const scrollPosition = highlightRange.from;
        try {
            view.dispatch({
                selection: EditorSelection.cursor(scrollPosition),
                effects: [
                    EditorView.scrollIntoView(scrollPosition, { y: 'center' }),
                    setReferenceHighlightEffect.of(highlightRange),
                ],
            });
        } catch (error) {
            logger.warn('Failed to scroll to link target', error);
        }
    };

    const reassertScroll = (): void => {
        if (resolveNoteId() === target.targetNoteId) {
            const range = resolveNavigationTarget(view.state.doc.toString(), target.navigationTarget);
            if (range) {
                doScroll(range);
            }
        }
    };

    const tryScroll = (): void => {
        // Bail if the user navigated away again before the content settled.
        if (resolveNoteId() !== target.targetNoteId) {
            return;
        }

        const text = view.state.doc.toString();
        const highlightRange = resolveNavigationTarget(text, target.navigationTarget);
        if (!highlightRange) {
            attempt += 1;
            if (attempt <= MAX_ATTEMPTS) {
                window.setTimeout(tryScroll, RETRY_DELAY_MS);
            }
            return;
        }

        doScroll(highlightRange);
        // Re-assert once after Joplin's own post-load cursor/scroll restoration.
        window.setTimeout(reassertScroll, REASSERT_DELAY_MS);
    };

    window.setTimeout(tryScroll, 0);
}
