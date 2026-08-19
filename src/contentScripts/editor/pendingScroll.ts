/**
 * Scrolls a just-loaded note to the spot a selected panel row stands for.
 *
 * The navigation itself is performed by the plugin host; this module only handles what happens in
 * the editor once the target note's content appears.
 *
 * See:
 * - ../backlinksNavigator.ts - records the pending scroll before navigating away
 */

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { findHtmlAnchorById, parseHtmlAnchors, type HtmlAnchor } from '../../markdown/htmlAnchors';
import { extractNoteLinks, type NoteLinkOccurrence } from '../../markdown/linkExtraction';
import { findHeadingByAnchor, parseMarkdownHeadings, type MarkdownHeading } from '../../markdown/markdownHeadings';
import { parseMarkdownBody } from '../../markdown/markdownParser';
import logger from '../../logger';
import { setReferenceHighlightEffect } from './referenceHighlight';
import type { TextRange } from './textRange';

/**
 * Where to scroll the target note once it loads, recorded before navigating away.
 *
 * - `reference` — a backlink: the rendered Markdown-link occurrence that links back to the note we
 *   came from.
 * - `anchor` — an outgoing link to an anchor: the heading that anchor names, or the explicit HTML
 *   anchor (`<a id="…">`) it points at.
 */
export type PendingScroll = { targetNoteId: string } & (
    | { kind: 'reference'; referencedNoteId: string; occurrenceIndex: number }
    | { kind: 'anchor'; anchor: string }
);

const MAX_ATTEMPTS = 15;
const RETRY_DELAY_MS = 80;
// Joplin restores its own cursor/scroll position shortly after a note loads; re-assert after that.
const REASSERT_DELAY_MS = 150;

/**
 * Resolves the range to place the cursor at and highlight in the just-loaded note.
 * Returns null while the target can't be found (the note content may not have settled).
 */
function resolveScrollRange(
    target: PendingScroll,
    links: readonly NoteLinkOccurrence[] = [],
    headings: readonly MarkdownHeading[] = [],
    htmlAnchors: readonly HtmlAnchor[] = []
): TextRange | null {
    if (target.kind === 'anchor') {
        // A heading slug wins over an explicit HTML anchor with the same name, matching
        // how the row's label/preview were resolved on the host side.
        const heading = findHeadingByAnchor(headings, target.anchor);
        if (heading) {
            return { from: heading.from, to: heading.to };
        }
        const htmlAnchor = findHtmlAnchorById(htmlAnchors, target.anchor);
        return htmlAnchor ? { from: htmlAnchor.from, to: htmlAnchor.to } : null;
    }
    const occurrence = links.filter((link) => link.targetId === target.referencedNoteId)[target.occurrenceIndex];
    return occurrence ? { from: occurrence.from, to: occurrence.to } : null;
}

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
    let parsedText: string | null = null;
    let parsedLinks: NoteLinkOccurrence[] = [];
    let parsedHeadings: MarkdownHeading[] = [];
    let parsedHtmlAnchors: HtmlAnchor[] = [];

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

    const reassertScroll = (highlightRange: TextRange): void => {
        if (resolveNoteId() === target.targetNoteId) {
            doScroll(highlightRange);
        }
    };

    const tryScroll = (): void => {
        // Bail if the user navigated away again before the content settled.
        if (resolveNoteId() !== target.targetNoteId) {
            return;
        }

        const text = view.state.doc.toString();
        if (text !== parsedText) {
            parsedText = text;
            if (target.kind === 'anchor') {
                const parsed = parseMarkdownBody(text);
                parsedHeadings = parseMarkdownHeadings(parsed);
                parsedHtmlAnchors = parseHtmlAnchors(parsed);
            } else {
                parsedLinks = extractNoteLinks(parseMarkdownBody(text));
            }
        }
        const highlightRange = resolveScrollRange(target, parsedLinks, parsedHeadings, parsedHtmlAnchors);
        if (!highlightRange) {
            attempt += 1;
            if (attempt <= MAX_ATTEMPTS) {
                window.setTimeout(tryScroll, RETRY_DELAY_MS);
            }
            return;
        }

        doScroll(highlightRange);
        // Re-assert once after Joplin's own post-load cursor/scroll restoration.
        window.setTimeout(() => reassertScroll(highlightRange), REASSERT_DELAY_MS);
    };

    window.setTimeout(tryScroll, 0);
}
