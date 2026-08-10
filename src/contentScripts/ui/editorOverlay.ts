/**
 * Shared mounting, positioning, and style injection for the floating elements the plugin adds to
 * the editor: the links panel and the indicator badge.
 *
 * Both anchor to the top-right of the editor's scroll area and must stay clear of its scrollbar, so
 * that behavior lives here instead of being repeated per component. The CSS half of the same
 * contract is `OVERLAY_ANCHOR_CSS` in `panelTheme.ts`.
 */

import { EditorView } from '@codemirror/view';

/** Gap between an overlay's right edge and the editor's scrollbar. */
const OVERLAY_RIGHT_GAP_PX = 8;

/** Records which inputs a stylesheet was generated from, so it is only rebuilt when they change. */
const STYLE_SIGNATURE_ATTR = 'data-overlay-signature';

/**
 * The element overlays mount into: the scroll container's parent, so an overlay stays put while the
 * document scrolls beneath it. Falls back to the editor element itself in unexpected DOM shapes.
 */
function resolveOverlayRoot(view: EditorView): HTMLElement {
    return view.scrollDOM.parentElement ?? view.dom.parentElement ?? view.dom;
}

export interface EditorOverlayOptions {
    /**
     * Keep the overlay's `right` offset clear of the editor's scrollbar, tracking width changes.
     * Disable when the stylesheet positions the element itself, as the mobile panel does by
     * centering it.
     */
    trackScrollbar?: boolean;
}

/**
 * A floating element anchored to the top-right of the editor.
 *
 * Owns the element's mount root and its scrollbar-aware `right` offset, including the
 * `ResizeObserver` that keeps that offset current — {@link destroy} disconnects it.
 */
export class EditorOverlay {
    private readonly view: EditorView;

    private readonly element: HTMLElement;

    private readonly trackScrollbar: boolean;

    private scrollerObserver: ResizeObserver | null = null;

    public constructor(view: EditorView, element: HTMLElement, options: EditorOverlayOptions = {}) {
        this.view = view;
        this.element = element;
        this.trackScrollbar = options.trackScrollbar ?? true;
    }

    /** Mounts the element and starts tracking the scrollbar width. Does nothing if already mounted. */
    public mount(): void {
        if (this.isMounted()) {
            return;
        }
        resolveOverlayRoot(this.view).appendChild(this.element);

        if (!this.trackScrollbar) {
            return;
        }
        this.updateRightOffset();
        this.scrollerObserver = new ResizeObserver(() => this.updateRightOffset());
        this.scrollerObserver.observe(this.view.scrollDOM);
    }

    public isMounted(): boolean {
        return Boolean(this.element.parentElement);
    }

    /** Unmounts the element and releases the scrollbar observer. Safe to call more than once. */
    public destroy(): void {
        this.scrollerObserver?.disconnect();
        this.scrollerObserver = null;
        this.element.remove();
    }

    private updateRightOffset(): void {
        const scrollDOM = this.view.scrollDOM;
        const scrollbarWidth = scrollDOM.offsetWidth - scrollDOM.clientWidth;
        this.element.style.right = `${scrollbarWidth + OVERLAY_RIGHT_GAP_PX}px`;
    }
}

/**
 * Injects an overlay's stylesheet into the editor's document, keeping one `<style>` per `styleId`.
 *
 * `createCss` runs only when the stylesheet is missing or was built from a different `signature`,
 * so callers whose CSS depends on settings pass a signature derived from them. Callers with fixed
 * CSS omit it, and the stylesheet is built once however often this is called.
 */
export function ensureOverlayStyles(
    view: EditorView,
    styleId: string,
    createCss: () => string,
    signature = 'static'
): void {
    const doc = view.dom.ownerDocument!;

    let style = doc.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
        style = doc.createElement('style');
        style.id = styleId;
        (doc.head ?? doc.body).appendChild(style);
    } else if (style.getAttribute(STYLE_SIGNATURE_ATTR) === signature) {
        return;
    }

    style.setAttribute(STYLE_SIGNATURE_ATTR, signature);
    style.textContent = createCss();
}
