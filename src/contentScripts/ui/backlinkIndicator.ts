import { EditorView } from '@codemirror/view';
import { createIndicatorCss } from '../theme/panelTheme';

const INDICATOR_RIGHT_GAP_PX = 8;
const INDICATOR_STYLE_ID = 'backlinks-navigator-indicator-styles';

const LINK_ICON_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
    '<path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
    '</svg>';

/**
 * Small clickable badge mounted in the top-right of the editor that signals the current
 * note has backlinks. Shows a link icon and the backlink count; clicking it opens the panel.
 *
 * Mounted as a floating overlay in the editor's scroll DOM (not via CodeMirror's full-width
 * Panel API), positioned to mirror the backlinks panel.
 */
export class BacklinkIndicator {
    private readonly view: EditorView;

    private readonly button: HTMLButtonElement;

    private readonly countEl: HTMLSpanElement;

    private readonly onClick: () => void;

    public constructor(view: EditorView, onClick: () => void) {
        this.view = view;
        this.onClick = onClick;

        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'backlinks-navigator-indicator';
        this.button.title = 'Show backlinks';
        this.button.style.display = 'none';

        const icon = document.createElement('span');
        icon.className = 'backlinks-navigator-indicator-icon';
        icon.innerHTML = LINK_ICON_SVG;

        this.countEl = document.createElement('span');
        this.countEl.className = 'backlinks-navigator-indicator-count';

        this.button.appendChild(icon);
        this.button.appendChild(this.countEl);

        this.button.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            this.onClick();
        });
    }

    /** Shows the indicator with the given backlink count. */
    public show(count: number): void {
        this.mount();
        this.countEl.textContent = String(count);
        this.button.title = `Show backlinks (${count})`;
        this.button.setAttribute('aria-label', `${count} backlink${count === 1 ? '' : 's'}`);
        this.button.style.display = 'inline-flex';
    }

    /** Hides the indicator (stays mounted for cheap re-show). */
    public hide(): void {
        this.button.style.display = 'none';
    }

    private mount(): void {
        if (this.button.parentElement) {
            return;
        }
        // Inject the indicator's own stylesheet so it's styled immediately, independent of
        // whether the (dimension-dependent) panel stylesheet has been injected yet.
        ensureIndicatorStyles(this.view);

        const scrollRoot = this.view.scrollDOM.parentElement;
        const fallbackRoot = this.view.dom.parentElement ?? this.view.dom;
        (scrollRoot ?? fallbackRoot).appendChild(this.button);

        this.updateRightOffset();
        new ResizeObserver(() => this.updateRightOffset()).observe(this.view.scrollDOM);
    }

    private updateRightOffset(): void {
        const scrollDOM = this.view.scrollDOM;
        const scrollbarWidth = scrollDOM.offsetWidth - scrollDOM.clientWidth;
        this.button.style.right = `${scrollbarWidth + INDICATOR_RIGHT_GAP_PX}px`;
    }
}

function ensureIndicatorStyles(view: EditorView): void {
    const doc = view.dom.ownerDocument!;
    if (doc.getElementById(INDICATOR_STYLE_ID)) {
        return;
    }
    const style = doc.createElement('style');
    style.id = INDICATOR_STYLE_ID;
    style.textContent = createIndicatorCss();
    (doc.head ?? doc.body).appendChild(style);
}
