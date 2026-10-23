import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ContentScriptContext } from 'api/types';
import type { IndicatorState, MessageOf, Protocol } from '../messages';
import { type LinkItem, EMPTY_LINK_COUNTS } from '../types';
import { IndicatorController } from './indicatorController';
import {
    applyContentScriptSettings,
    createSettingsExtension,
    DEFAULT_CONTENT_SCRIPT_SETTINGS,
} from './editor/pluginSettings';

const COUNTS = { backlinkOccurrences: 3, backlinkNotes: 2, outgoing: 4 };
const ENABLED: IndicatorState = { enabled: true, ok: true, counts: COUNTS };
const DEBOUNCE_MS = 350;

class FakeResizeObserver {
    public observe(): void {}
    public disconnect(): void {}
    public unobserve(): void {}
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function link(noteId: string, direction: 'in' | 'out' = 'in'): LinkItem {
    const row = { noteId, id: noteId, title: noteId, notebookName: '', section: '', snippet: '' };
    return direction === 'in'
        ? { ...row, direction, occurrenceIndex: 0, occurrenceCount: 1 }
        : { ...row, direction, anchor: '' };
}

const cleanups: (() => void)[] = [];
function harness(response: () => Promise<IndicatorState | undefined> = () => Promise.resolve(ENABLED)) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({ parent, state: EditorState.create({ extensions: [createSettingsExtension()] }) });
    applyContentScriptSettings(view, { ...DEFAULT_CONTENT_SCRIPT_SETTINGS, showIndicator: true });
    let noteId: string | null = 'note-a';
    let panelOpen = false;
    const postMessage = vi.fn((message: MessageOf<keyof Protocol>) =>
        message.type === 'getIndicatorState' ? response() : Promise.resolve(undefined)
    );
    const controller = new IndicatorController(view, { postMessage } as unknown as ContentScriptContext, {
        resolveNoteId: () => noteId,
        isPanelOpen: () => panelOpen,
    });
    cleanups.push(() => {
        controller.dispose();
        view.destroy();
    });
    const refresh = async (): Promise<void> => {
        controller.scheduleRefresh();
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    };
    return {
        controller,
        view,
        postMessage,
        refresh,
        setNote: (value: string | null) => {
            noteId = value;
        },
        setPanelOpen: (value: boolean) => {
            panelOpen = value;
        },
    };
}

function badge(): HTMLButtonElement | null {
    return document.querySelector('.backlinks-navigator-indicator');
}

describe('IndicatorController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });
    afterEach(() => {
        cleanups.splice(0).forEach((cleanup) => cleanup());
        document.body.replaceChildren();
        document.head.replaceChildren();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('debounces rapid refreshes into one request', async () => {
        const h = harness();
        h.controller.scheduleRefresh();
        await vi.advanceTimersByTimeAsync(200);
        h.controller.scheduleRefresh();
        h.controller.scheduleRefresh();
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
        expect(h.postMessage).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'getIndicatorState', noteId: 'note-a' });
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('3 backlinks, 4 outgoing links');
    });

    it('ignores a superseded response', async () => {
        const first = deferred<IndicatorState>();
        const response = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(ENABLED);
        const h = harness(response);
        await h.refresh();
        await h.refresh();
        first.resolve({ enabled: false });
        await vi.advanceTimersByTimeAsync(0);
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('3 backlinks, 4 outgoing links');
    });

    it('ignores a response for a note that is no longer active', async () => {
        const response = deferred<IndicatorState>();
        const h = harness(() => response.promise);
        await h.refresh();
        h.setNote('note-b');
        response.resolve(ENABLED);
        await vi.advanceTimersByTimeAsync(0);
        expect(badge()?.style.display ?? 'none').toBe('none');
    });

    it('retries while the note-id facet is empty', async () => {
        const h = harness();
        h.setNote(null);
        await h.refresh();
        await vi.advanceTimersByTimeAsync(300);
        expect(h.postMessage).not.toHaveBeenCalled();
        h.setNote('note-b');
        await vi.advanceTimersByTimeAsync(150);
        expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'getIndicatorState', noteId: 'note-b' });
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('3 backlinks, 4 outgoing links');
    });

    it('stops retrying after five retries', async () => {
        const h = harness();
        h.setNote(null);
        await h.refresh();
        await vi.advanceTimersByTimeAsync(750);
        h.setNote('note-b');
        await vi.advanceTimersByTimeAsync(150);
        expect(h.postMessage).not.toHaveBeenCalled();
    });

    it('replaces a pending facet retry with a newly scheduled refresh', async () => {
        const h = harness();
        h.setNote(null);
        await h.refresh();
        h.setNote('note-b');
        await h.refresh();
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        expect(h.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'getIndicatorState', noteId: 'note-b' });
    });

    it('cancels a queued refresh on disposal', async () => {
        const h = harness();
        h.controller.scheduleRefresh();
        h.controller.dispose();
        h.controller.dispose();
        h.controller.scheduleRefresh();
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        expect(h.postMessage).not.toHaveBeenCalled();
    });

    it('ignores an in-flight response after disposal', async () => {
        const response = deferred<IndicatorState>();
        const h = harness(() => response.promise);
        await h.refresh();
        h.controller.dispose();
        response.resolve(ENABLED);
        await vi.advanceTimersByTimeAsync(0);
        expect(badge()).toBeNull();
    });

    it('does not request from a facet retry after disposal', async () => {
        const h = harness();
        h.setNote(null);
        await h.refresh();
        h.controller.dispose();
        h.setNote('note-b');
        await vi.advanceTimersByTimeAsync(150);
        expect(h.postMessage).not.toHaveBeenCalled();
    });

    it('does not record links while disabled', async () => {
        const h = harness(() => Promise.resolve({ enabled: false }));
        await h.refresh();
        h.controller.recordLinks('in', [link('a')]);
        h.controller.recordLinks('out', [link('b', 'out')]);
        h.controller.sync();
        expect(badge()?.style.display ?? 'none').toBe('none');
    });

    it('records both directions without changing the other count or synchronizing visibility', async () => {
        const h = harness();
        await h.refresh();
        h.setPanelOpen(true);
        h.controller.sync();
        h.controller.recordLinks('in', [link('a'), link('a')]);
        expect(badge()?.style.display ?? 'none').toBe('none');
        h.setPanelOpen(false);
        h.controller.sync();
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('2 backlinks, 4 outgoing links');
        h.controller.recordLinks('out', [link('b', 'out')]);
        h.controller.sync();
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('2 backlinks, 1 outgoing link');
        applyContentScriptSettings(h.view, {
            ...DEFAULT_CONTENT_SCRIPT_SETTINGS,
            panel: { ...DEFAULT_CONTENT_SCRIPT_SETTINGS.panel, preview: { in: 'title', out: 'title' } },
            showIndicator: true,
        });
        h.controller.sync();
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('1 backlink, 1 outgoing link');
    });

    it('ignores an in-flight response after the setting is turned off', async () => {
        const response = deferred<IndicatorState>();
        const h = harness(() => response.promise);
        await h.refresh();
        applyContentScriptSettings(h.view, { ...DEFAULT_CONTENT_SCRIPT_SETTINGS, showIndicator: false });
        h.controller.reset();
        response.resolve(ENABLED);
        await vi.advanceTimersByTimeAsync(0);
        expect(badge()?.style.display ?? 'none').toBe('none');
    });

    it('keeps the badge hidden while the panel is open', async () => {
        const h = harness();
        h.setPanelOpen(true);
        await h.refresh();
        expect(badge()?.style.display ?? 'none').toBe('none');
        h.setPanelOpen(false);
        h.controller.sync();
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('3 backlinks, 4 outgoing links');
    });

    it.each([
        { enabled: true, ok: true, counts: EMPTY_LINK_COUNTS },
        { enabled: true, ok: false },
        { enabled: false },
        undefined,
    ] satisfies (IndicatorState | undefined)[])('hides an existing badge for state %j', async (state) => {
        const response = vi.fn().mockResolvedValueOnce(ENABLED).mockResolvedValueOnce(state);
        const h = harness(response);
        await h.refresh();
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('3 backlinks, 4 outgoing links');
        await h.refresh();
        expect(badge()?.style.display ?? 'none').toBe('none');
    });

    it('reset clears counts and hides the badge without invalidating an in-flight refresh', async () => {
        const pending = deferred<IndicatorState>();
        const h = harness(vi.fn().mockResolvedValueOnce(ENABLED).mockReturnValueOnce(pending.promise));
        await h.refresh();
        await h.refresh();
        h.controller.reset();
        h.controller.sync();
        expect(badge()?.style.display ?? 'none').toBe('none');
        pending.resolve(ENABLED);
        await vi.advanceTimersByTimeAsync(0);
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('3 backlinks, 4 outgoing links');
    });

    it('reset does not cancel a queued refresh', async () => {
        const h = harness();
        h.controller.scheduleRefresh();
        h.controller.reset();
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        expect(badge()?.style.display).toBe('inline-flex');
        expect(badge()?.getAttribute('aria-label')).toBe('3 backlinks, 4 outgoing links');
    });

    it('sends openPanel when the badge is clicked', async () => {
        const h = harness();
        await h.refresh();
        badge()?.click();
        expect(h.postMessage).toHaveBeenLastCalledWith({ type: 'openPanel' });
    });
});
