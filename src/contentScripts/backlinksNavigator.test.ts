import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { EditorState, Facet, StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CodeMirrorControl, ContentScriptContext } from 'api/types';
import { DEFAULT_LINK_PREVIEW_SETTINGS, DEFAULT_PANEL_DIMENSIONS } from '../types';
import { EDITOR_COMMAND_TOGGLE_PANEL, EDITOR_COMMAND_UPDATE_SETTINGS } from '../constants';
import type { IndicatorState, LinksResponse, MessageOf, Protocol } from '../messages';
import backlinksNavigator from './backlinksNavigator';

const INDICATOR_DEBOUNCE_MS = 350;

const noteIdFacet = Facet.define<string, string>({
    combine: (values) => values[0] ?? '',
});

class FakeResizeObserver {
    public static readonly instances: FakeResizeObserver[] = [];

    public constructor() {
        FakeResizeObserver.instances.push(this);
    }

    public observe(): void {}

    public disconnect(): void {}

    public unobserve(): void {}
}

vi.stubGlobal('ResizeObserver', FakeResizeObserver);

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

const SETTINGS = {
    panel: {
        dimensions: DEFAULT_PANEL_DIMENSIONS,
        preview: DEFAULT_LINK_PREVIEW_SETTINGS,
    },
    showIndicator: true,
};

const INDICATOR_COUNTS = {
    backlinkOccurrences: 1,
    backlinkNotes: 1,
    outgoing: 0,
};

function createHarness(
    indicatorResponse: () => Promise<IndicatorState>,
    linksResponse: LinksResponse = { ok: true, links: [] }
) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: EditorState.create({
            extensions: [noteIdFacet.of('note-a')],
        }),
    });

    const postMessage = vi.fn((message: MessageOf<keyof Protocol>): Promise<unknown> => {
        if (message.type === 'getContentScriptSettings') {
            return Promise.resolve(SETTINGS);
        }
        if (message.type === 'getIndicatorState') {
            return indicatorResponse();
        }
        if (message.type === 'getBacklinks' || message.type === 'getOutgoingLinks') {
            return Promise.resolve(linksResponse);
        }
        return Promise.resolve(undefined);
    });
    const context = {
        pluginId: 'test-plugin',
        contentScriptId: 'test-content-script',
        postMessage,
    } as ContentScriptContext;
    const commands = new Map<string, (...args: unknown[]) => void>();
    const editorControl = {
        editor: view,
        addExtension: (extension: Extension) => {
            view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
        },
        registerCommand: (name: string, handler: (...args: unknown[]) => void) => {
            commands.set(name, handler);
        },
        joplinExtensions: { noteIdFacet },
    } as unknown as CodeMirrorControl;

    backlinksNavigator(context).plugin(editorControl);
    const runCommand = (name: string, ...args: unknown[]): void => {
        const handler = commands.get(name);
        if (!handler) {
            throw new Error(`Command not registered: ${name}`);
        }
        handler(...args);
    };
    return { postMessage, runCommand, view };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('backlinksNavigator indicator teardown', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.replaceChildren();
        document.head.replaceChildren();
        FakeResizeObserver.instances.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('cancels a queued indicator refresh when the editor is destroyed', async () => {
        const response = createDeferred<IndicatorState>();
        const { postMessage, view } = createHarness(() => response.promise);
        await flushPromises();

        view.destroy();
        await vi.advanceTimersByTimeAsync(INDICATOR_DEBOUNCE_MS);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'getContentScriptSettings' });
    });

    it('does not remount the indicator when an in-flight refresh resolves after teardown', async () => {
        const response = createDeferred<IndicatorState>();
        const { postMessage, view } = createHarness(() => response.promise);
        await flushPromises();
        await vi.advanceTimersByTimeAsync(INDICATOR_DEBOUNCE_MS);
        expect(postMessage).toHaveBeenLastCalledWith({
            type: 'getIndicatorState',
            noteId: 'note-a',
        });

        const observerCountBeforeTeardown = FakeResizeObserver.instances.length;
        view.destroy();
        response.resolve({ enabled: true, ok: true, counts: INDICATOR_COUNTS });
        await flushPromises();

        expect(document.querySelector('.backlinks-navigator-indicator')).toBeNull();
        expect(FakeResizeObserver.instances).toHaveLength(observerCountBeforeTeardown);
    });
});

describe('backlinksNavigator host failures', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.replaceChildren();
        document.head.replaceChildren();
        FakeResizeObserver.instances.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows a load error instead of the empty state when the host reports a failed lookup', async () => {
        const { runCommand } = createHarness(() => Promise.resolve({ enabled: false }), { ok: false });
        await flushPromises();

        runCommand(EDITOR_COMMAND_TOGGLE_PANEL, false);
        await flushPromises();

        const message = document.querySelector('.backlinks-navigator-message')?.textContent;
        expect(message).toMatch(/^Failed to load /);
    });

    it('hides the indicator when the host fails to count links', async () => {
        const indicatorResponse = vi
            .fn<() => Promise<IndicatorState>>()
            .mockResolvedValueOnce({ enabled: true, ok: true, counts: INDICATOR_COUNTS })
            .mockResolvedValueOnce({ enabled: true, ok: false });
        const { runCommand } = createHarness(indicatorResponse);
        await flushPromises();
        await vi.advanceTimersByTimeAsync(INDICATOR_DEBOUNCE_MS);

        const indicator = document.querySelector<HTMLElement>('.backlinks-navigator-indicator');
        expect(indicator?.style.display).toBe('inline-flex');

        // A settings push schedules another refresh, which this time fails.
        runCommand(EDITOR_COMMAND_UPDATE_SETTINGS, SETTINGS);
        await vi.advanceTimersByTimeAsync(INDICATOR_DEBOUNCE_MS);

        expect(indicatorResponse).toHaveBeenCalledTimes(2);
        expect(indicator?.style.display).toBe('none');
    });
});
