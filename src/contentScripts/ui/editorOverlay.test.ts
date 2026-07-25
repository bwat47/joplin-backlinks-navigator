import { vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { EditorOverlay, ensureOverlayStyles } from './editorOverlay';

const OVERLAY_RIGHT_GAP_PX = 8;

const observed: HTMLElement[] = [];
const disconnected: HTMLElement[] = [];

/** Minimal ResizeObserver stand-in: jsdom has none, and the callback is driven manually. */
class FakeResizeObserver {
    public static instances: FakeResizeObserver[] = [];

    private target: HTMLElement | null = null;

    public constructor(private readonly callback: () => void) {
        FakeResizeObserver.instances.push(this);
    }

    public observe(target: HTMLElement): void {
        this.target = target;
        observed.push(target);
    }

    public disconnect(): void {
        if (this.target) {
            disconnected.push(this.target);
        }
    }

    /** Simulates the editor resizing. */
    public trigger(): void {
        this.callback();
    }
}

vi.stubGlobal('ResizeObserver', FakeResizeObserver);

/** Builds a stand-in view whose scroller reports the given scrollbar width. */
function createView(options: { scrollbarWidth?: number; detachScroller?: boolean } = {}): EditorView {
    const { scrollbarWidth = 0, detachScroller = false } = options;

    const editorParent = document.createElement('div');
    const dom = document.createElement('div');
    const scrollRoot = document.createElement('div');
    const scrollDOM = document.createElement('div');

    editorParent.appendChild(dom);
    if (!detachScroller) {
        dom.appendChild(scrollRoot);
        scrollRoot.appendChild(scrollDOM);
    }

    setScrollbarWidth(scrollDOM, scrollbarWidth);
    document.body.appendChild(editorParent);

    return { dom, scrollDOM } as unknown as EditorView;
}

function setScrollbarWidth(scrollDOM: HTMLElement, width: number): void {
    Object.defineProperty(scrollDOM, 'offsetWidth', { value: 500 + width, configurable: true });
    Object.defineProperty(scrollDOM, 'clientWidth', { value: 500, configurable: true });
}

describe('EditorOverlay', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        document.head.replaceChildren();
        observed.length = 0;
        disconnected.length = 0;
        FakeResizeObserver.instances = [];
    });

    it('mounts into the scroller’s parent so it does not scroll with the document', () => {
        const view = createView();
        const element = document.createElement('div');

        new EditorOverlay(view, element).mount();

        expect(element.parentElement).toBe(view.scrollDOM.parentElement);
    });

    it('falls back to the editor element when the scroller has no parent', () => {
        const view = createView({ detachScroller: true });
        const element = document.createElement('div');

        new EditorOverlay(view, element).mount();

        // scrollDOM is detached, so the editor's own parent is used.
        expect(element.parentElement).toBe(view.dom.parentElement);
    });

    it('offsets the element clear of the editor scrollbar', () => {
        const view = createView({ scrollbarWidth: 15 });
        const element = document.createElement('div');

        new EditorOverlay(view, element).mount();

        expect(element.style.right).toBe(`${15 + OVERLAY_RIGHT_GAP_PX}px`);
    });

    it('re-applies the offset when the editor resizes', () => {
        const view = createView({ scrollbarWidth: 15 });
        const element = document.createElement('div');
        new EditorOverlay(view, element).mount();

        setScrollbarWidth(view.scrollDOM, 0);
        FakeResizeObserver.instances[0].trigger();

        expect(element.style.right).toBe(`${OVERLAY_RIGHT_GAP_PX}px`);
        expect(observed).toEqual([view.scrollDOM]);
    });

    it('mounts only once', () => {
        const view = createView();
        const element = document.createElement('div');
        const overlay = new EditorOverlay(view, element);

        overlay.mount();
        overlay.mount();

        expect(view.scrollDOM.parentElement!.childElementCount).toBe(2); // the scroller and the overlay
        expect(FakeResizeObserver.instances).toHaveLength(1);
    });

    it('unmounts and disconnects its observer on destroy', () => {
        const view = createView();
        const element = document.createElement('div');
        const overlay = new EditorOverlay(view, element);
        overlay.mount();

        overlay.destroy();

        expect(overlay.isMounted()).toBe(false);
        expect(element.parentElement).toBeNull();
        expect(disconnected).toEqual([view.scrollDOM]);
    });

    it('tolerates destroy without a prior mount, and repeated destroys', () => {
        const overlay = new EditorOverlay(createView(), document.createElement('div'));

        expect(() => {
            overlay.destroy();
            overlay.destroy();
        }).not.toThrow();
    });

    it('leaves positioning to the stylesheet when scrollbar tracking is off', () => {
        const view = createView({ scrollbarWidth: 15 });
        const element = document.createElement('div');

        new EditorOverlay(view, element, { trackScrollbar: false }).mount();

        expect(element.parentElement).toBe(view.scrollDOM.parentElement);
        expect(element.style.right).toBe('');
        expect(FakeResizeObserver.instances).toHaveLength(0);
    });
});

describe('ensureOverlayStyles', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        document.head.replaceChildren();
    });

    it('injects the stylesheet once for callers with fixed CSS', () => {
        const view = createView();
        const createCss = vi.fn(() => '.a { color: red; }');

        ensureOverlayStyles(view, 'style-a', createCss);
        ensureOverlayStyles(view, 'style-a', createCss);

        expect(createCss).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll('#style-a')).toHaveLength(1);
        expect(document.getElementById('style-a')!.textContent).toBe('.a { color: red; }');
    });

    it('rebuilds the stylesheet in place when the signature changes', () => {
        const view = createView();

        ensureOverlayStyles(view, 'style-b', () => '.b { width: 360px; }', '360');
        ensureOverlayStyles(view, 'style-b', () => '.b { width: 480px; }', '480');

        expect(document.querySelectorAll('#style-b')).toHaveLength(1);
        expect(document.getElementById('style-b')!.textContent).toBe('.b { width: 480px; }');
    });

    it('skips rebuilding when the signature is unchanged', () => {
        const view = createView();
        const createCss = vi.fn(() => '.c { width: 360px; }');

        ensureOverlayStyles(view, 'style-c', createCss, '360');
        ensureOverlayStyles(view, 'style-c', createCss, '360');

        expect(createCss).toHaveBeenCalledTimes(1);
    });

    it('keeps one stylesheet per id', () => {
        const view = createView();

        ensureOverlayStyles(view, 'style-d', () => '.d {}');
        ensureOverlayStyles(view, 'style-e', () => '.e {}');

        expect(document.getElementById('style-d')).not.toBeNull();
        expect(document.getElementById('style-e')).not.toBeNull();
    });
});
