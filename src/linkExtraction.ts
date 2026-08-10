/** Pure helpers for finding rendered Joplin note links in a shared Markdown parse. */

import type { ParsedMarkdownBody } from './markdownParser';
import { extractReferenceLabel, parseLinkDestination, referenceDefinitions } from './markdownText';

const NOTE_LINK_DESTINATION_RE = /^:\/([0-9a-fA-F]{32})(?:#([\s\S]*))?$/;

/** Builds the literal link prefix used to prefilter backlink search results. */
export function linkNeedle(noteId: string): string {
    return `:/${noteId}`;
}

/** A single rendered internal-link occurrence. */
export interface NoteLinkOccurrence {
    targetId: string;
    anchor: string;
    from: number;
    to: number;
}

function normalizeLinkAnchor(anchor: string): string {
    try {
        return decodeURIComponent(anchor.replace(/\+/g, '%20')).toLowerCase();
    } catch {
        return anchor.toLowerCase();
    }
}

function parseNoteLinkDestination(destination: string): Pick<NoteLinkOccurrence, 'targetId' | 'anchor'> | null {
    const match = NOTE_LINK_DESTINATION_RE.exec(destination);
    if (!match) {
        return null;
    }
    return {
        targetId: match[1].toLowerCase(),
        anchor: normalizeLinkAnchor(match[2] ?? ''),
    };
}

/**
 * Finds inline and valid reference-style note links in document order with exact source ranges.
 * Images, raw HTML, bare destinations, code, comments, and undefined references are excluded.
 */
export function extractNoteLinks(parsed: ParsedMarkdownBody): NoteLinkOccurrence[] {
    // Definitions may follow their uses, so the whole index has to exist before resolving any link.
    const references = referenceDefinitions(parsed);
    const occurrences: NoteLinkOccurrence[] = [];

    parsed.tree.iterate({
        enter(cursor) {
            if (cursor.name === 'Image') {
                return false;
            }
            if (cursor.name !== 'Link') {
                return;
            }

            const urlNode = cursor.node.getChild('URL');
            const destination = urlNode
                ? parseLinkDestination(parsed, urlNode)
                : references.get(extractReferenceLabel(parsed, cursor.node));
            const target = destination === undefined ? null : parseNoteLinkDestination(destination);
            if (target) {
                occurrences.push({ ...target, from: cursor.from, to: cursor.to });
            }
            return false;
        },
    });

    return occurrences;
}
