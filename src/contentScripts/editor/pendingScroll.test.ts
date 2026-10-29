import { assert, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectionRange } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { createNavigationTarget } from '../../navigationTarget';
import { parseMarkdownBody } from '../../markdown/markdownParser';
import { scrollToPendingTarget } from './pendingScroll';

describe('scrollToPendingTarget', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const source = 'Intro\n\n# Setup\n\nSteps';
    const navigationTarget = createNavigationTarget(parseMarkdownBody(source), { from: 7, to: 14 });

    function harness(initialBody = source) {
        let body = initialBody;
        let noteId = 'target';
        const dispatch = vi.fn<(transaction: { selection: SelectionRange }) => void>();
        const view = {
            state: { doc: { toString: () => body } },
            dispatch,
        } as unknown as EditorView;
        scrollToPendingTarget(view, { targetNoteId: 'target', navigationTarget }, () => noteId);
        return {
            dispatch,
            setBody: (text: string) => {
                body = text;
            },
            setNote: (id: string) => {
                noteId = id;
            },
        };
    }

    it('waits for the destination text to arrive', async () => {
        const h = harness('');
        await vi.advanceTimersByTimeAsync(0);
        expect(h.dispatch).not.toHaveBeenCalled();
        h.setBody(source);
        await vi.advanceTimersByTimeAsync(80);
        const [call] = h.dispatch.mock.calls;
        assert.isDefined(call);
        expect(call[0].selection.head).toBe(7);
    });

    it('revalidates the source range before reasserting the scroll', async () => {
        const h = harness();
        await vi.advanceTimersByTimeAsync(0);
        h.setBody('New\n' + source);
        await vi.advanceTimersByTimeAsync(150);
        expect(h.dispatch).toHaveBeenCalledTimes(2);
        const [, call] = h.dispatch.mock.calls;
        assert.isDefined(call);
        expect(call[0].selection.head).toBe(11);
    });

    it('does not reassert a removed target', async () => {
        const h = harness();
        await vi.advanceTimersByTimeAsync(0);
        h.setBody('Heading removed');
        await vi.advanceTimersByTimeAsync(150);
        expect(h.dispatch).toHaveBeenCalledTimes(1);
    });

    it('does not scroll after leaving the note', async () => {
        const h = harness('');
        await vi.advanceTimersByTimeAsync(0);
        h.setBody(source);
        h.setNote('other');
        await vi.runAllTimersAsync();
        expect(h.dispatch).not.toHaveBeenCalled();
    });

    it('gives up without moving the cursor if the target never arrives', async () => {
        const h = harness('A different heading');
        await vi.runAllTimersAsync();
        expect(h.dispatch).not.toHaveBeenCalled();
    });
});
