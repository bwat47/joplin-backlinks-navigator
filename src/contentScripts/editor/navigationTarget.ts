import type { NavigationTarget } from '../../types';
import type { TextRange } from './textRange';

/**
 * Validates a host range against the current editor text. If edits shifted it, accept a unique
 * exact-text match, or use the surrounding context to distinguish repeated matches. Ambiguous
 * matches are left alone rather than guessing which occurrence the user selected.
 */
export function resolveNavigationTarget(body: string, target: NavigationTarget): TextRange | null {
    const { from, to, text, contextBefore, contextAfter } = target;
    if (!text) {
        return null;
    }
    if (from >= 0 && to - from === text.length && body.slice(from, to) === text) {
        return { from, to };
    }

    let unique: TextRange | null = null;
    let contextual: TextRange | null = null;
    let matches = 0;
    let contextualMatches = 0;
    for (let position = body.indexOf(text); position !== -1; position = body.indexOf(text, position + 1)) {
        const range = { from: position, to: position + text.length };
        unique = range;
        matches += 1;
        if (
            body.slice(Math.max(0, position - contextBefore.length), position) === contextBefore &&
            body.slice(range.to, range.to + contextAfter.length) === contextAfter
        ) {
            contextual = range;
            contextualMatches += 1;
        }
    }
    if (matches === 1) {
        return unique;
    }
    return contextualMatches === 1 ? contextual : null;
}
