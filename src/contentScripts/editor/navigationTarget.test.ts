import { describe, expect, it } from 'vitest';
import { createNavigationTarget } from '../../host/navigationTarget';
import { resolveNavigationTarget } from './navigationTarget';

describe('resolveNavigationTarget', () => {
    const body = 'Intro 😀\n\n[link](:/note)\n\nFollowing text';
    const from = body.indexOf('[link]');
    const target = createNavigationTarget(body, { from, to: body.indexOf(')') + 1 });

    it('uses host offsets in unchanged text, including UTF-16 offsets', () => {
        expect(resolveNavigationTarget(body, target)).toEqual({ from, to: target.to });
    });

    it('relocates exact source text after an insertion or deletion before it', () => {
        expect(resolveNavigationTarget('New intro\n' + body, target)).toEqual({
            from: from + 10,
            to: target.to + 10,
        });
        expect(resolveNavigationTarget(body.slice(6), target)).toEqual({ from: from - 6, to: target.to - 6 });
    });

    it('uses context to distinguish repeated source text after offsets shift', () => {
        const source = 'A'.repeat(40) + '[same]' + 'B'.repeat(40) + '[same]' + 'C'.repeat(40);
        const start = source.lastIndexOf('[same]');
        const repeated = createNavigationTarget(source, { from: start, to: start + 6 });
        expect(resolveNavigationTarget('Prefix' + source, repeated)).toEqual({ from: start + 6, to: start + 12 });
    });

    it('leaves ambiguous or changed targets unresolved', () => {
        expect(resolveNavigationTarget('[link](:/note) and [link](:/note)', target)).toBeNull();
        expect(resolveNavigationTarget(body.replace('[link]', '[renamed]'), target)).toBeNull();
        expect(resolveNavigationTarget('', target)).toBeNull();
        expect(resolveNavigationTarget(body, { ...target, text: '' })).toBeNull();
    });
});
