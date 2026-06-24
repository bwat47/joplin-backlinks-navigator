import { EditorView } from '@codemirror/view';
import type { LinkDirection, LinkItem, PanelSettings } from '../../types';
import { createPanelCss } from '../theme/panelTheme';
import { getDisplayLinkCount, getDisplayLinks } from '../../linkDisplay';
import { fuzzyFilter, highlightMatch } from './fuzzyFilter';

const PANEL_STYLE_ID = 'backlinks-navigator-styles';
const FILTER_DEBOUNCE_MS = 80;
const PANEL_RIGHT_GAP_PX = 8;

export type PanelCloseReason = 'escape' | 'blur';

type TabState = 'loading' | 'ready' | 'error';
type SelectCallback = (link: LinkItem) => Promise<void> | void;

export interface PanelCallbacks {
    onSelect: SelectCallback;
    onCtrlClickSelect: SelectCallback;
    onCtrlEnterSelect: SelectCallback;
    onClose: (reason: PanelCloseReason) => void;
}

interface TabModel {
    items: LinkItem[];
    state: TabState;
    error: string;
}

const TAB_LABELS: Record<LinkDirection, string> = {
    in: 'Backlinks',
    out: 'Outgoing Links',
};

/**
 * Floating panel UI listing the links related to the current note, split into two tabs:
 * inbound backlinks (`in`) and outbound links (`out`).
 *
 * Renders a filterable, keyboard-navigable list for the active tab. The panel opens in a loading
 * state; the content script then populates each tab (or an error message) once the plugin host
 * responds. The active tab is auto-selected from the resolved counts (backlinks if any exist,
 * otherwise outgoing) until the user manually switches.
 *
 * Each entry shows the linked note's title, its parent notebook, and a snippet of the line
 * containing the link. Selecting an entry invokes `onSelect`, which the content script forwards
 * to the host for navigation (using the entry's `direction` to decide the behavior).
 */
export class BacklinksPanel {
    private readonly view: EditorView;

    private readonly container: HTMLDivElement;

    private readonly tabBar: HTMLDivElement;

    private readonly tabButtons: Record<LinkDirection, HTMLButtonElement>;

    private readonly input: HTMLInputElement;

    private readonly list: HTMLUListElement;

    private readonly tabs: Record<LinkDirection, TabModel> = {
        in: { items: [], state: 'loading', error: '' },
        out: { items: [], state: 'loading', error: '' },
    };

    private activeTab: LinkDirection = 'in';

    private userSwitchedTab = false;

    private filtered: LinkItem[] = [];

    private selectedId: string | null = null;

    private filterText = '';

    private settings: PanelSettings;

    private filterDebounceTimer: number | null = null;

    private readonly onSelect: SelectCallback;

    private readonly onCtrlClickSelect: SelectCallback;

    private readonly onCtrlEnterSelect: SelectCallback;

    private readonly onClose: (reason: PanelCloseReason) => void;

    private readonly handleInputListener: () => void;

    private readonly handleKeyDownListener: (event: KeyboardEvent) => void;

    private readonly handleListClickListener: (event: MouseEvent) => void;

    private readonly handleTabClickListener: (event: MouseEvent) => void;

    private readonly handleDocumentMouseDownListener: (event: MouseEvent) => void;

    private scrollerObserver: ResizeObserver | null = null;

    public constructor(
        view: EditorView,
        callbacks: PanelCallbacks,
        settings: PanelSettings,
        private readonly isMobile = false
    ) {
        this.view = view;
        this.onSelect = callbacks.onSelect;
        this.onCtrlClickSelect = callbacks.onCtrlClickSelect;
        this.onCtrlEnterSelect = callbacks.onCtrlEnterSelect;
        this.onClose = callbacks.onClose;
        this.settings = settings;

        this.container = document.createElement('div');
        this.container.className = 'backlinks-navigator-panel';
        if (this.isMobile) {
            this.container.classList.add('is-mobile');
        }

        this.tabBar = document.createElement('div');
        this.tabBar.className = 'backlinks-navigator-tabs';
        this.tabButtons = {
            in: this.createTabButton('in'),
            out: this.createTabButton('out'),
        };
        this.tabBar.appendChild(this.tabButtons.in);
        this.tabBar.appendChild(this.tabButtons.out);
        this.container.appendChild(this.tabBar);

        this.input = document.createElement('input');
        this.input.type = 'search';
        this.input.placeholder = 'Filter';
        this.input.className = 'backlinks-navigator-input';
        this.container.appendChild(this.input);

        this.list = document.createElement('ul');
        this.list.className = 'backlinks-navigator-list';
        this.container.appendChild(this.list);

        this.handleInputListener = () => this.scheduleFilterUpdate();
        this.handleKeyDownListener = (event: KeyboardEvent) => this.handleKeyDown(event);
        this.handleListClickListener = (event: MouseEvent) => this.handleListClick(event);
        this.handleTabClickListener = (event: MouseEvent) => this.handleTabClick(event);
        this.handleDocumentMouseDownListener = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && !this.container.contains(target)) {
                this.onClose('blur');
            }
        };

        this.input.addEventListener('input', this.handleInputListener);
        this.input.addEventListener('keydown', this.handleKeyDownListener);
        this.list.addEventListener('click', this.handleListClickListener);
        this.tabBar.addEventListener('click', this.handleTabClickListener);
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
        this.filtered = [];
        this.activeTab = 'in';
        this.userSwitchedTab = false;
        this.tabs.in = { items: [], state: 'loading', error: '' };
        this.tabs.out = { items: [], state: 'loading', error: '' };
        this.updateTabButtons();
        this.render();
        requestAnimationFrame(() => {
            if (this.isOpen()) {
                this.input.focus();
            }
        });
    }

    /**
     * Populates a tab with its resolved links (terminal "ready" state).
     */
    public setLinks(direction: LinkDirection, links: LinkItem[]): void {
        this.tabs[direction] = { items: links, state: 'ready', error: '' };
        this.afterTabResolved(direction);
    }

    /**
     * Shows an error message in place of a tab's list.
     */
    public setError(direction: LinkDirection, message: string): void {
        this.tabs[direction] = { items: [], state: 'error', error: message };
        this.afterTabResolved(direction);
    }

    public destroy(): void {
        this.input.removeEventListener('input', this.handleInputListener);
        this.input.removeEventListener('keydown', this.handleKeyDownListener);
        this.list.removeEventListener('click', this.handleListClickListener);
        this.tabBar.removeEventListener('click', this.handleTabClickListener);
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

    public setSettings(settings: PanelSettings): void {
        this.settings = settings;
        ensurePanelStyles(this.view, this.settings);
        // Re-derive counts and the visible list: the backlink preview mode can change whether
        // occurrences are collapsed to one row per note (see displayItems).
        this.updateTabButtons();
        this.applyFilter(this.input.value);
    }

    /**
     * The items to display for a tab. Backlinks in title-only mode are collapsed to one row per
     * linked note: with no snippet to tell occurrences apart, repeating the same title adds nothing.
     * Items arrive sorted by title then occurrence, so the kept row is each note's first occurrence.
     */
    private displayItems(direction: LinkDirection): LinkItem[] {
        return getDisplayLinks(this.tabs[direction].items, direction, this.settings.preview[direction]);
    }

    private createTabButton(direction: LinkDirection): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'backlinks-navigator-tab';
        button.dataset.tab = direction;

        const label = document.createElement('span');
        label.textContent = TAB_LABELS[direction];
        button.appendChild(label);

        const count = document.createElement('span');
        count.className = 'backlinks-navigator-tab-count';
        button.appendChild(count);

        return button;
    }

    /**
     * Updates tab counts and, unless the user has manually switched tabs, re-evaluates which tab
     * should be active given the directions resolved so far. Then refreshes the active list.
     */
    private afterTabResolved(direction: LinkDirection): void {
        const previousActive = this.activeTab;
        const nextActive = this.applyDefaultTab();
        const activeChanged = nextActive !== previousActive;
        if (activeChanged) {
            this.activeTab = nextActive;
            this.selectedId = null;
        }
        this.updateTabButtons();
        // Re-filter when the active tab changed or the tab on screen just got its data.
        if (activeChanged || direction === this.activeTab) {
            this.applyFilter(this.input.value);
        }
    }

    /**
     * Computes the tab to show based on resolved counts: backlinks if any exist, else outgoing if
     * any exist, else backlinks. Tabs still loading are left undecided (keeps the current tab).
     */
    private applyDefaultTab(): LinkDirection {
        if (this.userSwitchedTab) {
            return this.activeTab;
        }
        const inResolved = this.tabs.in.state !== 'loading';
        const outResolved = this.tabs.out.state !== 'loading';
        const inCount =
            this.tabs.in.state === 'ready'
                ? getDisplayLinkCount(this.tabs.in.items, 'in', this.settings.preview.in)
                : 0;
        const outCount =
            this.tabs.out.state === 'ready'
                ? getDisplayLinkCount(this.tabs.out.items, 'out', this.settings.preview.out)
                : 0;

        if (inResolved && inCount > 0) {
            return 'in';
        }
        if (outResolved && outCount > 0) {
            return 'out';
        }
        if (inResolved && outResolved) {
            return 'in';
        }
        return this.activeTab;
    }

    private updateTabButtons(): void {
        (['in', 'out'] as LinkDirection[]).forEach((direction) => {
            const button = this.tabButtons[direction];
            const tab = this.tabs[direction];
            button.classList.toggle('is-active', direction === this.activeTab);
            const countEl = button.querySelector<HTMLSpanElement>('.backlinks-navigator-tab-count');
            if (countEl) {
                countEl.textContent =
                    tab.state === 'ready'
                        ? String(getDisplayLinkCount(tab.items, direction, this.settings.preview[direction]))
                        : '';
            }
        });
    }

    private handleTabClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        const button = target?.closest<HTMLButtonElement>('.backlinks-navigator-tab');
        const direction = button?.dataset.tab as LinkDirection | undefined;
        if (!direction || direction === this.activeTab) {
            return;
        }
        this.switchTab(direction);
    }

    private switchTab(direction: LinkDirection): void {
        this.userSwitchedTab = true;
        this.activeTab = direction;
        this.selectedId = null;
        this.updateTabButtons();
        this.applyFilter(this.input.value);
        if (this.isOpen()) {
            this.input.focus();
        }
    }

    private mount(): void {
        ensurePanelStyles(this.view, this.settings);

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

    private get activeModel(): TabModel {
        return this.tabs[this.activeTab];
    }

    private applyFilter(filterText: string): void {
        this.filterText = filterText.trim();
        const model = this.activeModel;
        this.filtered = model.state === 'ready' ? fuzzyFilter(this.filterText, this.displayItems(this.activeTab)) : [];

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
                if (event.ctrlKey) {
                    this.switchTab(this.activeTab === 'in' ? 'out' : 'in');
                    break;
                }
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
                this.confirmSelection(event.ctrlKey);
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

    private confirmSelection(useCtrlEnterBehavior: boolean): void {
        if (!this.selectedId) {
            return;
        }
        const link = this.filtered.find((b) => b.id === this.selectedId);
        if (link) {
            if (useCtrlEnterBehavior) {
                this.refocusInputAfter(this.onCtrlEnterSelect(link));
            } else {
                this.onSelect(link);
            }
        }
    }

    private handleListClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        const itemElement = target?.closest<HTMLLIElement>('.backlinks-navigator-item');
        if (!itemElement) {
            return;
        }
        const id = itemElement.dataset.linkId;
        if (!id) {
            return;
        }
        const link = this.filtered.find((b) => b.id === id);
        if (link) {
            this.selectedId = id;
            this.updateSelection();
            if (event.ctrlKey) {
                this.refocusInputAfter(this.onCtrlClickSelect(link));
            } else {
                this.onSelect(link);
            }
        }
    }

    private refocusInputAfter(result: Promise<void> | void): void {
        void Promise.resolve(result).finally(() => {
            window.setTimeout(() => {
                if (this.isOpen()) {
                    this.input.focus();
                }
            }, 0);
        });
    }

    private render(): void {
        const model = this.activeModel;
        const noun = this.activeTab === 'in' ? 'backlinks' : 'links';

        if (model.state === 'loading') {
            this.renderMessage(`Loading ${noun}…`);
            return;
        }
        if (model.state === 'error') {
            this.renderMessage(model.error || `Failed to load ${noun}`);
            return;
        }
        if (!this.filtered.length) {
            const empty = this.activeTab === 'in' ? 'No backlinks found' : 'No outgoing links';
            this.renderMessage(this.filterText ? `No matching ${noun}` : empty);
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
        for (const link of this.filtered) {
            fragment.appendChild(this.createItem(link));
        }
        this.list.replaceChildren(fragment);
    }

    private createItem(link: LinkItem): HTMLLIElement {
        const item = document.createElement('li');
        item.className = 'backlinks-navigator-item';
        item.dataset.linkId = link.id;
        if (link.id === this.selectedId) {
            item.classList.add('is-selected');
        }

        const header = document.createElement('div');
        header.className = 'backlinks-navigator-item-header';

        const title = document.createElement('span');
        title.className = 'backlinks-navigator-item-title';
        title.appendChild(highlightMatch(link.title, this.filterText));
        header.appendChild(title);

        const occurrenceLabel = this.formatOccurrenceLabel(link);
        const metadata = [link.notebookName, occurrenceLabel].filter(Boolean).join(' - ');

        if (metadata) {
            const notebook = document.createElement('span');
            notebook.className = 'backlinks-navigator-item-notebook';
            notebook.textContent = metadata;
            header.appendChild(notebook);
        }

        item.appendChild(header);

        const previewMode = this.settings.preview[link.direction];
        const showSnippet = previewMode === 'titleSnippet' || previewMode === 'titleSnippetHeading';
        const showHeading = previewMode === 'titleSnippetHeading';

        if (showHeading && link.section) {
            const section = document.createElement('span');
            section.className = 'backlinks-navigator-item-section';
            section.textContent = `§ ${link.section}`;
            item.appendChild(section);
        }

        if (showSnippet && link.snippet) {
            const snippet = document.createElement('span');
            snippet.className = 'backlinks-navigator-item-snippet';
            snippet.textContent = link.snippet;
            item.appendChild(snippet);
        }

        return item;
    }

    private formatOccurrenceLabel(link: LinkItem): string {
        if (link.direction !== 'in' || link.occurrenceCount <= 1) {
            return '';
        }
        // Title-only backlinks are collapsed to one row per note, so a per-occurrence index
        // (e.g. "1/3") would be misleading; the row stands for the note, not one occurrence.
        if (this.settings.preview.in === 'title') {
            return '';
        }
        return `${link.occurrenceIndex + 1}/${link.occurrenceCount}`;
    }

    private updateSelection(): void {
        const items = this.list.querySelectorAll<HTMLLIElement>('.backlinks-navigator-item');
        items.forEach((item) => {
            item.classList.toggle('is-selected', item.dataset.linkId === this.selectedId);
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

function ensurePanelStyles(view: EditorView, settings: PanelSettings): void {
    const doc = view.dom.ownerDocument!;
    // Cache key based only on dimensions since CSS variables handle theme changes automatically.
    const options = settings.dimensions;
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
