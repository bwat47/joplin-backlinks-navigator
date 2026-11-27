/**
 * Fuzzy search filtering and highlighting for link entries.
 *
 * Uses fuzzysort for Sublime Text-like fuzzy matching against note titles.
 */

import fuzzysort from 'fuzzysort';

import type { LinkItem } from '../../types';

/** Minimum match score (0-1); 0 accepts any match. */
const FUZZY_THRESHOLD = 0;
const FUZZY_LIMIT = 200;

/**
 * Filters and ranks links by fuzzy match score against their title.
 *
 * When query is empty, returns the links in their original (title-sorted) order.
 */
export function fuzzyFilter(query: string, links: LinkItem[]): LinkItem[] {
    const normalized = query.trim();

    if (!normalized) {
        return [...links];
    }

    const results = fuzzysort.go(normalized, links, {
        key: 'title',
        limit: FUZZY_LIMIT,
        threshold: FUZZY_THRESHOLD,
    });

    // fuzzysort doesn't keep the input order among equal scores, so ties fall back to it here. The
    // host already sorted it (title, note, then occurrence or anchor), and every row of a note
    // shares its title and so its score, so a note's rows stay in order.
    const inputIndex = new Map(links.map((link, index) => [link, index]));
    return [...results]
        .sort((a, b) => b.score - a.score || inputIndex.get(a.obj)! - inputIndex.get(b.obj)!)
        .map((result) => result.obj);
}

/**
 * Creates a DocumentFragment with matched characters wrapped in <b> elements.
 *
 * Uses DOM manipulation instead of innerHTML for security.
 */
export function highlightMatch(text: string, query: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const normalized = query.trim();

    if (!normalized) {
        fragment.appendChild(document.createTextNode(text));
        return fragment;
    }

    const result = fuzzysort.single(normalized, text);

    if (!result || result.indexes.length === 0) {
        fragment.appendChild(document.createTextNode(text));
        return fragment;
    }

    const matchIndexes = new Set(result.indexes);
    let i = 0;

    while (i < text.length) {
        if (matchIndexes.has(i)) {
            const bold = document.createElement('b');
            let matchedChars = '';
            while (i < text.length && matchIndexes.has(i)) {
                matchedChars += text[i];
                i++;
            }
            bold.textContent = matchedChars;
            fragment.appendChild(bold);
        } else {
            let normalChars = '';
            while (i < text.length && !matchIndexes.has(i)) {
                normalChars += text[i];
                i++;
            }
            fragment.appendChild(document.createTextNode(normalChars));
        }
    }

    return fragment;
}
