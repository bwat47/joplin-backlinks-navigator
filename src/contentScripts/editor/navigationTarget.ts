import type { NavigationTarget } from '../../types';
import type { TextRange } from './textRange';

function hasContext(body: string, range: TextRange, target: NavigationTarget): boolean {
    const { contextBefore, contextAfter } = target;
    return (
        body.slice(Math.max(0, range.from - contextBefore.length), range.from) === contextBefore &&
        body.slice(range.to, range.to + contextAfter.length) === contextAfter
    );
}

/**
 * Validates a host range against the current editor text. The supplied offsets win when both the
 * text and its context still match. Otherwise accept a unique exact-text match, or use the context
 * to distinguish repeated matches; an identical occurrence may have shifted onto the old offsets.
 * If that search is inconclusive, fall back to an exact-text match at the supplied offsets (e.g. an
 * edit next to an unmoved target). Ambiguous matches are left alone rather than guessing which
 * occurrence the user selected.
 */
export function resolveNavigationTarget(body: string, target: NavigationTarget): TextRange | null {
    const { from, to, text } = target;
    if (!text) {
        return null;
    }
    const atOffsets = from >= 0 && to - from === text.length && body.slice(from, to) === text ? { from, to } : null;
    if (atOffsets && hasContext(body, atOffsets, target)) {
        return atOffsets;
    }

    let unique: TextRange | null = null;
    let contextual: TextRange | null = null;
    let matches = 0;
    let contextualMatches = 0;
    for (let position = body.indexOf(text); position !== -1; position = body.indexOf(text, position + 1)) {
        const range = { from: position, to: position + text.length };
        unique = range;
        matches += 1;
        if (hasContext(body, range, target)) {
            contextual = range;
            contextualMatches += 1;
        }
    }
    if (matches === 1) {
        return unique;
    }
    if (contextualMatches === 1) {
        return contextual;
    }
    return atOffsets;
}
