import { EditorView } from '@codemirror/view';
import { createIndicatorCss } from '../theme/panelTheme';

const INDICATOR_RIGHT_GAP_PX = 8;
const INDICATOR_STYLE_ID = 'backlinks-navigator-indicator-styles';

const LINK_ICON_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
    '<path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
    '</svg>';

/** Counts of links related to the current note, by direction. */
export interface IndicatorCounts {
    backlinks: number;
    outgoing: number;
}

/**
 * Small clickable badge mounted in the top-right of the editor that signals the current
 * note has links. Shows a link icon and, per direction, the count of backlinks (inbound) and
 * outgoing links (outbound); clicking it opens the panel.
 *
 * Mounted as a floating overlay in the editor's scroll DOM (not via CodeMirror's full-width
 * Panel API), positioned to mirror the backlinks panel.
 */
export class BacklinkIndicator {
    private readonly view: EditorView;

    private readonly button: HTMLButtonElement;

    private readonly backlinksCountEl: HTMLSpanElement;

    private readonly outgoingCountEl: HTMLSpanElement;

    private readonly onClick: () => void;

    public constructor(view: EditorView, onClick: () => void) {
        this.view = view;
        this.onClick = onClick;

        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'backlinks-navigator-indicator';
        this.button.style.display = 'none';

        const icon = document.createElement('span');
        icon.className = 'backlinks-navigator-indicator-icon';
        icon.innerHTML = LINK_ICON_SVG;

        // "←" = inbound (backlinks), "→" = outbound (outgoing links).
        this.backlinksCountEl = document.createElement('span');
        this.backlinksCountEl.className = 'backlinks-navigator-indicator-count is-backlinks';
        this.outgoingCountEl = document.createElement('span');
        this.outgoingCountEl.className = 'backlinks-navigator-indicator-count is-outgoing';

        this.button.appendChild(icon);
        this.button.appendChild(this.backlinksCountEl);
        this.button.appendChild(this.outgoingCountEl);

        this.button.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            this.onClick();
        });
    }

    /** Shows the indicator with the given link counts, hiding the side that has none. */
    public show(counts: IndicatorCounts): void {
        this.mount();

        const showBacklinks = counts.backlinks > 0;
        const showOutgoing = counts.outgoing > 0;

        this.backlinksCountEl.textContent = showBacklinks ? `🡨 ${counts.backlinks}` : '';
        this.backlinksCountEl.style.display = showBacklinks ? 'inline' : 'none';
        this.outgoingCountEl.textContent = showOutgoing ? `🡪 ${counts.outgoing}` : '';
        this.outgoingCountEl.style.display = showOutgoing ? 'inline' : 'none';

        const label = describeCounts(counts);
        this.button.title = `Show links (${label})`;
        this.button.setAttribute('aria-label', label);
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

/** Builds a human-readable summary like "3 backlinks, 5 outgoing links" (omitting a zero side). */
function describeCounts(counts: IndicatorCounts): string {
    const parts: string[] = [];
    if (counts.backlinks > 0) {
        parts.push(`${counts.backlinks} backlink${counts.backlinks === 1 ? '' : 's'}`);
    }
    if (counts.outgoing > 0) {
        parts.push(`${counts.outgoing} outgoing link${counts.outgoing === 1 ? '' : 's'}`);
    }
    return parts.join(', ');
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
