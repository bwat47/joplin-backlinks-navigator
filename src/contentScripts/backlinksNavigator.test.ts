import { EditorState, Facet, StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CodeMirrorControl, ContentScriptContext } from 'api/types';
import { DEFAULT_LINK_PREVIEW_SETTINGS, DEFAULT_PANEL_DIMENSIONS } from '../types';
import type { ContentScriptToPluginMessage, IndicatorState } from '../messages';
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

function createHarness(indicatorResponse: Promise<IndicatorState>) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: EditorState.create({
            extensions: [noteIdFacet.of('note-a')],
        }),
    });

    const postMessage = vi.fn((message: ContentScriptToPluginMessage): Promise<unknown> => {
        if (message.type === 'getContentScriptSettings') {
            return Promise.resolve({
                panel: {
                    dimensions: DEFAULT_PANEL_DIMENSIONS,
                    preview: DEFAULT_LINK_PREVIEW_SETTINGS,
                },
                showIndicator: true,
            });
        }
        if (message.type === 'getIndicatorState') {
            return indicatorResponse;
        }
        return Promise.resolve(undefined);
    });
    const context = {
        pluginId: 'test-plugin',
        contentScriptId: 'test-content-script',
        postMessage,
    } as ContentScriptContext;
    const editorControl = {
        editor: view,
        addExtension: (extension: Extension) => {
            view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
        },
        registerCommand: vi.fn(),
        joplinExtensions: { noteIdFacet },
    } as unknown as CodeMirrorControl;

    backlinksNavigator(context).plugin(editorControl);
    return { postMessage, view };
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
        const { postMessage, view } = createHarness(response.promise);
        await flushPromises();

        view.destroy();
        await vi.advanceTimersByTimeAsync(INDICATOR_DEBOUNCE_MS);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'getContentScriptSettings' });
    });

    it('does not remount the indicator when an in-flight refresh resolves after teardown', async () => {
        const response = createDeferred<IndicatorState>();
        const { postMessage, view } = createHarness(response.promise);
        await flushPromises();
        await vi.advanceTimersByTimeAsync(INDICATOR_DEBOUNCE_MS);
        expect(postMessage).toHaveBeenLastCalledWith({
            type: 'getIndicatorState',
            noteId: 'note-a',
        });

        const observerCountBeforeTeardown = FakeResizeObserver.instances.length;
        view.destroy();
        response.resolve({
            enabled: true,
            counts: {
                backlinkOccurrences: 1,
                backlinkNotes: 1,
                outgoing: 0,
            },
        });
        await flushPromises();

        expect(document.querySelector('.backlinks-navigator-indicator')).toBeNull();
        expect(FakeResizeObserver.instances).toHaveLength(observerCountBeforeTeardown);
    });
});
