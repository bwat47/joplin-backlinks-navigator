import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ContentScriptContext } from 'api/types';
import type { LinksResponse, MessageOf, Protocol } from '../messages';
import type { Backlink, LinkItem, OutgoingLink } from '../types';
import { PanelController } from './panelController';
import {
    applyContentScriptSettings,
    createSettingsExtension,
    DEFAULT_CONTENT_SCRIPT_SETTINGS,
} from './editor/pluginSettings';

const CURRENT_NOTE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_NOTE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

class FakeResizeObserver {
    public observe(): void {}
    public disconnect(): void {}
    public unobserve(): void {}
}

// jsdom has no layout and doesn't define these; CodeMirror measures text ranges after scrolling.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

const ROW = { noteId: OTHER_NOTE, title: 'Other', notebookName: '', section: '', snippet: '' };

function backlink(occurrenceIndex: number): Backlink {
    return { ...ROW, direction: 'in', id: `${OTHER_NOTE}:${occurrenceIndex}`, occurrenceIndex, occurrenceCount: 2 };
}

function outgoing(anchor: string): OutgoingLink {
    return { ...ROW, direction: 'out', id: anchor ? `${OTHER_NOTE}#${anchor}` : OTHER_NOTE, anchor, isTrashed: false };
}

type LinkResponder = (message: MessageOf<'getBacklinks' | 'getOutgoingLinks'>) => Promise<LinksResponse>;

const cleanups: (() => void)[] = [];
function harness(links: { in?: LinkItem[]; out?: LinkItem[] } = {}, respond?: LinkResponder) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({ parent, state: EditorState.create({ extensions: [createSettingsExtension()] }) });
    applyContentScriptSettings(view, DEFAULT_CONTENT_SCRIPT_SETTINGS);
    let noteId: string | null = CURRENT_NOTE;
    const postMessage = vi.fn((message: MessageOf<keyof Protocol>): Promise<unknown> => {
        if (message.type === 'getBacklinks' || message.type === 'getOutgoingLinks') {
            if (respond) {
                return respond(message);
            }
            const rows = message.type === 'getBacklinks' ? links.in : links.out;
            return Promise.resolve({ ok: true, links: rows ?? [] });
        }
        return Promise.resolve(undefined);
    });
    const onVisibilityChange = vi.fn();
    const onLinksLoaded = vi.fn();
    const controller = new PanelController(view, { postMessage } as unknown as ContentScriptContext, {
        resolveNoteId: () => noteId,
        onVisibilityChange,
        onLinksLoaded,
    });
    cleanups.push(() => view.destroy());

    /** Simulates Joplin loading `id` with `body` into the reused editor view. */
    const switchNote = async (id: string, body: string): Promise<void> => {
        noteId = id;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body } });
        controller.handleNoteChange(id);
        await vi.runAllTimersAsync();
    };
    const open = async (): Promise<void> => {
        controller.toggle();
        await vi.advanceTimersByTimeAsync(0);
    };
    return { controller, view, postMessage, onVisibilityChange, onLinksLoaded, switchNote, open };
}

function clickRow(id: string, init: MouseEventInit = {}): void {
    const item = document.querySelector(`.backlinks-navigator-item[data-link-id="${id}"]`);
    if (!item) {
        throw new Error(`Row not rendered: ${id}`);
    }
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
}

describe('PanelController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        document.body.replaceChildren();
        document.head.replaceChildren();
    });

    afterEach(() => {
        cleanups.splice(0).forEach((cleanup) => cleanup());
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('loads both directions on open and reports visibility changes', async () => {
        const rows = [backlink(0)];
        const h = harness({ in: rows });

        await h.open();

        expect(h.controller.isOpen()).toBe(true);
        expect(h.postMessage).toHaveBeenCalledWith({ type: 'getBacklinks', noteId: CURRENT_NOTE });
        expect(h.postMessage).toHaveBeenCalledWith({ type: 'getOutgoingLinks', noteId: CURRENT_NOTE });
        expect(h.onLinksLoaded).toHaveBeenCalledWith('in', rows);
        expect(h.onVisibilityChange).toHaveBeenCalledTimes(1);

        h.controller.toggle();

        expect(h.controller.isOpen()).toBe(false);
        expect(h.onVisibilityChange).toHaveBeenCalledTimes(2);
    });

    it('ignores a response that arrives after the panel closed', async () => {
        const pending = deferred<LinksResponse>();
        const h = harness({}, () => pending.promise);
        await h.open();

        h.controller.toggle();
        pending.resolve({ ok: true, links: [backlink(0)] });
        await vi.advanceTimersByTimeAsync(0);

        expect(h.onLinksLoaded).not.toHaveBeenCalled();
    });

    it('scrolls to the selected backlink occurrence once its source note loads', async () => {
        const h = harness({ in: [backlink(0), backlink(1)] });
        await h.open();

        clickRow(`${OTHER_NOTE}:1`);
        await vi.advanceTimersByTimeAsync(0);

        expect(h.controller.isOpen()).toBe(false);
        expect(h.postMessage).toHaveBeenCalledWith({ type: 'openNote', noteId: OTHER_NOTE, anchor: '' });
        const body = `First [a](:/${CURRENT_NOTE})\n\nSecond [b](:/${CURRENT_NOTE})`;
        await h.switchNote(OTHER_NOTE, body);
        expect(h.view.state.selection.main.head).toBe(body.indexOf('[b]'));
    });

    it('does not scroll to an occurrence when title-only backlinks collapse them', async () => {
        const h = harness({ in: [backlink(0), backlink(1)] });
        applyContentScriptSettings(h.view, {
            ...DEFAULT_CONTENT_SCRIPT_SETTINGS,
            panel: { ...DEFAULT_CONTENT_SCRIPT_SETTINGS.panel, preview: { in: 'title', out: 'titleSnippet' } },
        });
        await h.open();

        clickRow(`${OTHER_NOTE}:0`);
        await vi.advanceTimersByTimeAsync(0);
        await h.switchNote(OTHER_NOTE, `Intro\n\n[a](:/${CURRENT_NOTE})`);

        expect(h.view.state.selection.main.head).toBe(0);
    });

    it('scrolls to the heading an outgoing anchor names', async () => {
        const h = harness({ out: [outgoing('setup')] });
        await h.open();

        clickRow(`${OTHER_NOTE}#setup`);
        await vi.advanceTimersByTimeAsync(0);

        expect(h.postMessage).toHaveBeenCalledWith({ type: 'openNote', noteId: OTHER_NOTE, anchor: 'setup' });
        const body = 'Intro\n\n# Setup\n\nSteps';
        await h.switchNote(OTHER_NOTE, body);
        expect(h.view.state.selection.main.head).toBe(body.indexOf('# Setup'));
    });

    it('drops the pending scroll when a different note loads', async () => {
        const h = harness({ out: [outgoing('setup')] });
        await h.open();

        clickRow(`${OTHER_NOTE}#setup`);
        await vi.advanceTimersByTimeAsync(0);
        await h.switchNote('cccccccccccccccccccccccccccccccc', '# Setup');
        await h.switchNote(OTHER_NOTE, 'Intro\n\n# Setup');

        expect(h.view.state.selection.main.head).toBe(0);
    });

    it('opens an alternate-gesture selection without closing the panel or scrolling', async () => {
        const h = harness({ out: [outgoing('setup')] });
        await h.open();

        clickRow(`${OTHER_NOTE}#setup`, { ctrlKey: true });
        await vi.advanceTimersByTimeAsync(0);

        expect(h.postMessage).toHaveBeenCalledWith({
            type: 'openNote',
            noteId: OTHER_NOTE,
            anchor: 'setup',
            mode: 'ctrlClick',
        });
        expect(h.controller.isOpen()).toBe(true);
        h.controller.toggle();
        await h.switchNote(OTHER_NOTE, 'Intro\n\n# Setup');
        expect(h.view.state.selection.main.head).toBe(0);
    });
});
