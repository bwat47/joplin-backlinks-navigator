import type { NavigationTarget } from '../types';

const CONTEXT_LENGTH = 32;

/** Captures exact Markdown source, not the rendered label, for editor navigation. */
export function createNavigationTarget(body: string, range: { from: number; to: number }): NavigationTarget {
    const { from, to } = range;
    return {
        from,
        to,
        text: body.slice(from, to),
        contextBefore: body.slice(Math.max(0, from - CONTEXT_LENGTH), from),
        contextAfter: body.slice(to, to + CONTEXT_LENGTH),
    };
}
