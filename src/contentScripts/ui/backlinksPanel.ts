import { EditorView } from '@codemirror/view';
import type { BacklinkItem, PanelDimensions } from '../../types';
import { createPanelCss } from '../theme/panelTheme';
import { fuzzyFilter, highlightMatch } from './fuzzyFilter';

const PANEL_STYLE_ID = 'backlinks-navigator-styles';
const FILTER_DEBOUNCE_MS = 80;
const PANEL_RIGHT_GAP_PX = 8;

export type PanelCloseReason = 'escape' | 'blur';

type PanelState = 'loading' | 'ready' | 'error';

export interface PanelCallbacks {
    onSelect: (backlink: BacklinkItem) => void;
    onCtrlSelect: (backlink: BacklinkItem) => void;
    onClose: (reason: PanelCloseReason) => void;
}

/**
 * Floating panel UI listing the backlinks for the current note.
 *
 * Renders a filterable, keyboard-navigable list of notes that link to the current
 * note. The panel opens in a loading state; the content script then populates it
 * with results (or an error message) once the plugin host responds.
 *
 * Each entry shows the linking note's title, its parent notebook, and a snippet of
 * the line containing the link. Selecting an entry invokes `onSelect`, which the
 * content script forwards to the host for navigation.
 */
export class BacklinksPanel {
    private readonly view: EditorView;

    private readonly container: HTMLDivElement;

    private readonly input: HTMLInputElement;

    private readonly list: HTMLUListElement;

    private backlinks: BacklinkItem[] = [];

    private filtered: BacklinkItem[] = [];

    private selectedId: string | null = null;

    private filterText = '';

    private state: PanelState = 'loading';

    private errorMessage = '';

    private options: PanelDimensions;

    private filterDebounceTimer: number | null = null;

    private readonly onSelect: (backlink: BacklinkItem) => void;

    private readonly onCtrlSelect: (backlink: BacklinkItem) => void;

    private readonly onClose: (reason: PanelCloseReason) => void;

    private readonly handleInputListener: () => void;

    private readonly handleKeyDownListener: (event: KeyboardEvent) => void;

    private readonly handleListClickListener: (event: MouseEvent) => void;

    private readonly handleDocumentMouseDownListener: (event: MouseEvent) => void;

    private scrollerObserver: ResizeObserver | null = null;

    public constructor(
        view: EditorView,
        callbacks: PanelCallbacks,
        options: PanelDimensions,
        private readonly isMobile = false
    ) {
        this.view = view;
        this.onSelect = callbacks.onSelect;
        this.onCtrlSelect = callbacks.onCtrlSelect;
        this.onClose = callbacks.onClose;
        this.options = options;

        this.container = document.createElement('div');
        this.container.className = 'backlinks-navigator-panel';
        if (this.isMobile) {
            this.container.classList.add('is-mobile');
        }

        this.input = document.createElement('input');
        this.input.type = 'search';
        this.input.placeholder = 'Filter backlinks';
        this.input.className = 'backlinks-navigator-input';
        this.container.appendChild(this.input);

        this.list = document.createElement('ul');
        this.list.className = 'backlinks-navigator-list';
        this.container.appendChild(this.list);

        this.handleInputListener = () => this.scheduleFilterUpdate();
        this.handleKeyDownListener = (event: KeyboardEvent) => this.handleKeyDown(event);
        this.handleListClickListener = (event: MouseEvent) => this.handleListClick(event);
        this.handleDocumentMouseDownListener = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && !this.container.contains(target)) {
                this.onClose('blur');
            }
        };

        this.input.addEventListener('input', this.handleInputListener);
        this.input.addEventListener('keydown', this.handleKeyDownListener);
        this.list.addEventListener('click', this.handleListClickListener);
        this.view.dom.ownerDocument!.addEventListener('mousedown', this.handleDocumentMouseDownListener, true);
    }

    /**
     * Mounts the panel and shows the loading state, then focuses the filter input.
     */
    public open(): void {
        this.mount();
        this.input.value = '';
        this.filterText = '';
        this.selectedId = null;
        this.backlinks = [];
        this.filtered = [];
        this.state = 'loading';
        this.render();
        requestAnimationFrame(() => {
            if (this.isOpen()) {
                this.input.focus();
            }
        });
    }

    /**
     * Populates the panel with the resolved backlinks (terminal "ready" state).
     */
    public setBacklinks(backlinks: BacklinkItem[]): void {
        this.backlinks = backlinks;
        this.state = 'ready';
        this.applyFilter(this.input.value);
    }

    /**
     * Shows an error message in place of the list.
     */
    public setError(message: string): void {
        this.state = 'error';
        this.errorMessage = message;
        this.render();
    }

    public destroy(): void {
        this.input.removeEventListener('input', this.handleInputListener);
        this.input.removeEventListener('keydown', this.handleKeyDownListener);
        this.list.removeEventListener('click', this.handleListClickListener);
        this.view.dom.ownerDocument!.removeEventListener('mousedown', this.handleDocumentMouseDownListener, true);

        if (this.filterDebounceTimer !== null) {
            clearTimeout(this.filterDebounceTimer);
            this.filterDebounceTimer = null;
        }
        if (this.scrollerObserver) {
            this.scrollerObserver.disconnect();
            this.scrollerObserver = null;
        }
        if (this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }

    public isOpen(): boolean {
        return Boolean(this.container.parentElement);
    }

    public setOptions(options: PanelDimensions): void {
        this.options = options;
        ensurePanelStyles(this.view, this.options);
    }

    private mount(): void {
        ensurePanelStyles(this.view, this.options);

        if (!this.container.parentElement) {
            const scrollRoot = this.view.scrollDOM.parentElement;
            const fallbackRoot = this.view.dom.parentElement ?? this.view.dom;
            (scrollRoot ?? fallbackRoot).appendChild(this.container);

            if (this.isMobile) return;

            this.updateRightOffset();
            this.scrollerObserver = new ResizeObserver(() => this.updateRightOffset());
            this.scrollerObserver.observe(this.view.scrollDOM);
        }
    }

    private updateRightOffset(): void {
        const scrollDOM = this.view.scrollDOM;
        const scrollbarWidth = scrollDOM.offsetWidth - scrollDOM.clientWidth;
        this.container.style.right = `${scrollbarWidth + PANEL_RIGHT_GAP_PX}px`;
    }

    private scheduleFilterUpdate(): void {
        if (this.filterDebounceTimer !== null) {
            clearTimeout(this.filterDebounceTimer);
        }
        this.filterDebounceTimer = window.setTimeout(() => {
            this.filterDebounceTimer = null;
            this.applyFilter(this.input.value);
        }, FILTER_DEBOUNCE_MS);
    }

    private flushPendingFilter(): void {
        if (this.filterDebounceTimer !== null) {
            clearTimeout(this.filterDebounceTimer);
            this.filterDebounceTimer = null;
            this.applyFilter(this.input.value);
        }
    }

    private applyFilter(filterText: string): void {
        this.filterText = filterText.trim();
        this.filtered = this.state === 'ready' ? fuzzyFilter(this.filterText, this.backlinks) : [];

        if (this.filtered.length === 0) {
            this.selectedId = null;
        } else if (!this.selectedId || !this.filtered.some((b) => b.id === this.selectedId)) {
            this.selectedId = this.filtered[0].id;
        }

        this.render();
    }

    private handleKeyDown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.flushPendingFilter();
                this.moveSelection(1);
                break;
            case 'Tab':
                event.preventDefault();
                this.flushPendingFilter();
                this.moveSelection(event.shiftKey ? -1 : 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.flushPendingFilter();
                this.moveSelection(-1);
                break;
            case 'Enter':
                event.preventDefault();
                this.confirmSelection();
                break;
            case 'Escape':
                event.preventDefault();
                this.onClose('escape');
                break;
            default:
                break;
        }
    }

    private moveSelection(delta: number): void {
        if (!this.filtered.length) {
            return;
        }
        const currentIndex = this.filtered.findIndex((b) => b.id === this.selectedId);
        const nextIndex = currentIndex >= 0 ? (currentIndex + delta + this.filtered.length) % this.filtered.length : 0;
        this.selectedId = this.filtered[nextIndex].id;
        this.updateSelection();
        this.scrollActiveItemIntoView();
    }

    private confirmSelection(): void {
        if (!this.selectedId) {
            return;
        }
        const backlink = this.filtered.find((b) => b.id === this.selectedId);
        if (backlink) {
            this.onSelect(backlink);
        }
    }

    private handleListClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        const itemElement = target?.closest<HTMLLIElement>('.backlinks-navigator-item');
        if (!itemElement) {
            return;
        }
        const id = itemElement.dataset.backlinkId;
        if (!id) {
            return;
        }
        const backlink = this.filtered.find((b) => b.id === id);
        if (backlink) {
            this.selectedId = id;
            this.updateSelection();
            if (event.ctrlKey) {
                this.onCtrlSelect(backlink);
            } else {
                this.onSelect(backlink);
            }
        }
    }

    private render(): void {
        if (this.state === 'loading') {
            this.renderMessage('Loading backlinks…');
            return;
        }
        if (this.state === 'error') {
            this.renderMessage(this.errorMessage || 'Failed to load backlinks');
            return;
        }
        if (!this.filtered.length) {
            this.renderMessage(this.filterText ? 'No matching backlinks' : 'No backlinks found');
            return;
        }
        this.renderItems();
        this.scrollActiveItemIntoView();
    }

    private renderMessage(message: string): void {
        this.list.replaceChildren();
        const li = document.createElement('li');
        li.className = 'backlinks-navigator-message';
        li.textContent = message;
        this.list.appendChild(li);
    }

    private renderItems(): void {
        const fragment = document.createDocumentFragment();
        for (const backlink of this.filtered) {
            fragment.appendChild(this.createItem(backlink));
        }
        this.list.replaceChildren(fragment);
    }

    private createItem(backlink: BacklinkItem): HTMLLIElement {
        const item = document.createElement('li');
        item.className = 'backlinks-navigator-item';
        item.dataset.backlinkId = backlink.id;
        if (backlink.id === this.selectedId) {
            item.classList.add('is-selected');
        }

        const header = document.createElement('div');
        header.className = 'backlinks-navigator-item-header';

        const title = document.createElement('span');
        title.className = 'backlinks-navigator-item-title';
        title.appendChild(highlightMatch(backlink.title, this.filterText));
        header.appendChild(title);

        const occurrenceLabel =
            backlink.occurrenceCount > 1 ? `${backlink.occurrenceIndex + 1}/${backlink.occurrenceCount}` : '';
        const metadata = [backlink.notebookName, occurrenceLabel].filter(Boolean).join(' - ');

        if (metadata) {
            const notebook = document.createElement('span');
            notebook.className = 'backlinks-navigator-item-notebook';
            notebook.textContent = metadata;
            header.appendChild(notebook);
        }

        item.appendChild(header);

        if (backlink.section) {
            const section = document.createElement('span');
            section.className = 'backlinks-navigator-item-section';
            section.textContent = `§ ${backlink.section}`;
            item.appendChild(section);
        }

        if (backlink.snippet) {
            const snippet = document.createElement('span');
            snippet.className = 'backlinks-navigator-item-snippet';
            snippet.textContent = backlink.snippet;
            item.appendChild(snippet);
        }

        return item;
    }

    private updateSelection(): void {
        const items = this.list.querySelectorAll<HTMLLIElement>('.backlinks-navigator-item');
        items.forEach((item) => {
            item.classList.toggle('is-selected', item.dataset.backlinkId === this.selectedId);
        });
    }

    /**
     * Ensures the selected item is visible inside the scrolling container.
     * Uses manual scroll positioning to avoid layout thrash and ancestor scrolling.
     */
    private scrollActiveItemIntoView(): void {
        const container = this.list;
        const activeItem = container.querySelector<HTMLLIElement>('.backlinks-navigator-item.is-selected');
        if (!activeItem) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();

        const itemTop = itemRect.top - containerRect.top + container.scrollTop;
        const itemBottom = itemRect.bottom - containerRect.top + container.scrollTop;
        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;

        if (itemTop < viewTop) {
            container.scrollTop = itemTop;
            return;
        }
        if (itemBottom > viewBottom) {
            container.scrollTop = itemBottom - container.clientHeight;
        }
    }
}

function ensurePanelStyles(view: EditorView, options: PanelDimensions): void {
    const doc = view.dom.ownerDocument!;
    // Cache key based only on dimensions since CSS variables handle theme changes automatically.
    const signature = [options.width.toString(), options.maxHeightRatio.toFixed(4)].join('|');

    let style = doc.getElementById(PANEL_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = doc.createElement('style');
        style.id = PANEL_STYLE_ID;
        (doc.head ?? doc.body).appendChild(style);
    }

    if (style.getAttribute('data-dimensions-signature') === signature) {
        return;
    }

    style.setAttribute('data-dimensions-signature', signature);
    style.textContent = createPanelCss(options);
}
