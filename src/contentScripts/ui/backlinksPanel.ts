import type { EditorView } from '@codemirror/view';

import type { LinkDirection, LinkItem, PanelSettings } from '../../types';
import { buildPanelRows, countLinkedNotes, linkForRow, type PanelRow } from '../linkGroups';
import { EditorOverlay, ensureOverlayStyles } from './editorOverlay';
import { fuzzyFilter, highlightMatch } from './fuzzyFilter';
import { createPanelCss } from './panelTheme';

const PANEL_STYLE_ID = 'backlinks-navigator-styles';
const FILTER_DEBOUNCE_MS = 80;

export type PanelCloseReason = 'escape' | 'blur';

type TabState = 'loading' | 'ready' | 'error';
type SelectCallback = (link: LinkItem) => Promise<void> | void;

export interface PanelCallbacks {
    onSelect: (link: LinkItem) => void;
    onCtrlClickSelect: SelectCallback;
    onCtrlEnterSelect: SelectCallback;
    onMiddleClickSelect: SelectCallback;
    onClose: (reason: PanelCloseReason) => void;
    /** Called when the user toggles panel details, so the choice can be remembered. */
    onCollapseChange: (collapsed: boolean) => void;
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

// Lucide-style "chevrons" glyphs: pointing apart to show details, together to hide them.
const EXPAND_ICON_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>';
const COLLAPSE_ICON_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/></svg>';

// macOS names the Alt key Option (⌥); the tooltip uses the platform's own name for it.
const ALT_KEY_LABEL = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt+';

/**
 * Floating panel UI listing the links related to the current note, split into two tabs:
 * inbound backlinks (`in`) and outbound links (`out`).
 *
 * Renders a filterable, keyboard-navigable list for the active tab. The panel opens in a loading
 * state; the content script then populates each tab (or an error message) once the plugin host
 * responds. The active tab is auto-selected from the resolved counts (backlinks if any exist,
 * otherwise outgoing) until the user manually switches.
 *
 * Rows are grouped by linked note (see `linkGroups.ts`): a note with several backlink occurrences
 * or outgoing destinations gets a header showing its title, notebook, and link count, with its
 * links nested beneath. One toggle switches between compact (one title-only row per note) and
 * detailed (nested links and context snippets) views; the choice is reported through
 * `onCollapseChange` so it is remembered, and there is no per-group state. Selecting a row invokes
 * `onSelect`, which the content script forwards to the host for navigation.
 */
export class BacklinksPanel {
    private readonly view: EditorView;

    private readonly container: HTMLDivElement;

    private readonly tabBar: HTMLDivElement;

    private readonly tabButtons: Record<LinkDirection, HTMLButtonElement>;

    private readonly collapseToggle: HTMLButtonElement;

    private readonly input: HTMLInputElement;

    private readonly list: HTMLUListElement;

    private readonly tabs: Record<LinkDirection, TabModel> = {
        in: { items: [], state: 'loading', error: '' },
        out: { items: [], state: 'loading', error: '' },
    };

    private activeTab: LinkDirection = 'in';

    private userSwitchedTab = false;

    private rows: PanelRow[] = [];

    private selectedId: string | null = null;

    private filterText = '';

    private settings: PanelSettings;

    private filterDebounceTimer: number | null = null;

    private readonly onSelect: PanelCallbacks['onSelect'];

    private readonly onCtrlClickSelect: SelectCallback;

    private readonly onCtrlEnterSelect: SelectCallback;

    private readonly onMiddleClickSelect: SelectCallback;

    private readonly onClose: (reason: PanelCloseReason) => void;

    private readonly onCollapseChange: (collapsed: boolean) => void;

    private readonly handleInputListener: () => void;

    private readonly handleKeyDownListener: (event: KeyboardEvent) => void;

    private readonly handleInputContextMenuListener: (event: MouseEvent) => void;

    private readonly handleListClickListener: (event: MouseEvent) => void;

    private readonly handleListAuxClickListener: (event: MouseEvent) => void;

    private readonly handleListMouseDownListener: (event: MouseEvent) => void;

    private readonly handleTabClickListener: (event: MouseEvent) => void;

    private readonly handleDocumentMouseDownListener: (event: MouseEvent) => void;

    private readonly overlay: EditorOverlay;

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
        this.onMiddleClickSelect = callbacks.onMiddleClickSelect;
        this.onClose = callbacks.onClose;
        this.onCollapseChange = callbacks.onCollapseChange;
        this.settings = settings;

        this.container = document.createElement('div');
        this.container.className = 'backlinks-navigator-panel';
        if (this.isMobile) {
            this.container.classList.add('is-mobile');
        }
        // The mobile panel is centered by its stylesheet, so it must not be offset for a scrollbar.
        this.overlay = new EditorOverlay(view, this.container, { trackScrollbar: !this.isMobile });

        this.tabBar = document.createElement('div');
        this.tabBar.className = 'backlinks-navigator-tabs';
        this.tabButtons = {
            in: this.createTabButton('in'),
            out: this.createTabButton('out'),
        };
        this.collapseToggle = document.createElement('button');
        this.collapseToggle.type = 'button';
        this.collapseToggle.className = 'backlinks-navigator-collapse-toggle';
        this.tabBar.appendChild(this.tabButtons.in);
        this.tabBar.appendChild(this.tabButtons.out);
        this.tabBar.appendChild(this.collapseToggle);
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
        this.handleInputContextMenuListener = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
        };
        this.handleListClickListener = (event: MouseEvent) => this.handleListClick(event);
        this.handleListAuxClickListener = (event: MouseEvent) => this.handleListAuxClick(event);
        this.handleListMouseDownListener = (event: MouseEvent) => this.handleListMouseDown(event);
        this.handleTabClickListener = (event: MouseEvent) => this.handleTabClick(event);
        this.handleDocumentMouseDownListener = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && !this.container.contains(target)) {
                this.onClose('blur');
            }
        };

        this.input.addEventListener('input', this.handleInputListener);
        this.input.addEventListener('keydown', this.handleKeyDownListener);
        if (!this.isMobile) {
            this.input.addEventListener('contextmenu', this.handleInputContextMenuListener);
        }
        this.list.addEventListener('click', this.handleListClickListener);
        this.list.addEventListener('auxclick', this.handleListAuxClickListener);
        this.list.addEventListener('mousedown', this.handleListMouseDownListener);
        this.tabBar.addEventListener('click', this.handleTabClickListener);
        this.view.dom.ownerDocument.addEventListener('mousedown', this.handleDocumentMouseDownListener, true);
    }

    /**
     * Mounts the panel and shows the loading state, then focuses the filter input.
     */
    public open(): void {
        this.mount();
        this.overlay.syncEditorFont();
        this.input.value = '';
        this.filterText = '';
        this.selectedId = null;
        this.rows = [];
        this.activeTab = 'in';
        this.userSwitchedTab = false;
        this.tabs.in = { items: [], state: 'loading', error: '' };
        this.tabs.out = { items: [], state: 'loading', error: '' };
        this.updateTabButtons();
        this.updateCollapseToggle();
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
        if (!this.isMobile) {
            this.input.removeEventListener('contextmenu', this.handleInputContextMenuListener);
        }
        this.list.removeEventListener('click', this.handleListClickListener);
        this.list.removeEventListener('auxclick', this.handleListAuxClickListener);
        this.list.removeEventListener('mousedown', this.handleListMouseDownListener);
        this.tabBar.removeEventListener('click', this.handleTabClickListener);
        this.view.dom.ownerDocument.removeEventListener('mousedown', this.handleDocumentMouseDownListener, true);

        if (this.filterDebounceTimer !== null) {
            clearTimeout(this.filterDebounceTimer);
            this.filterDebounceTimer = null;
        }
        this.overlay.destroy();
    }

    public isOpen(): boolean {
        return this.overlay.isMounted();
    }

    /** Applies settings pushed by the host. */
    public setSettings(settings: PanelSettings): void {
        const rowsAffected =
            settings.showBacklinkHeading !== this.settings.showBacklinkHeading ||
            settings.collapseDetails !== this.settings.collapseDetails;
        this.settings = settings;
        ensurePanelStyles(this.view, this.settings);
        this.updateCollapseToggle();
        if (rowsAffected) {
            this.applyFilter(this.input.value);
        }
    }

    /**
     * Toggles between compact (title-only) and detailed (nested links + snippets) views, reporting
     * the choice so it is remembered. The selection follows its note: a hidden nested row hands it
     * to the note's header.
     */
    private setCollapsed(collapsed: boolean): void {
        if (collapsed === this.settings.collapseDetails) {
            return;
        }
        this.settings = { ...this.settings, collapseDetails: collapsed };
        this.updateCollapseToggle();
        this.applyFilter(this.input.value);
        this.onCollapseChange(collapsed);
    }

    private updateCollapseToggle(): void {
        const collapsed = this.settings.collapseDetails;
        const label = collapsed ? 'Show details' : 'Hide details';
        const arrow = collapsed ? '↓' : '↑';
        this.collapseToggle.innerHTML = collapsed ? EXPAND_ICON_SVG : COLLAPSE_ICON_SVG;
        this.collapseToggle.title = `${label} (${ALT_KEY_LABEL}${arrow})`;
        this.collapseToggle.setAttribute('aria-label', label);
        this.collapseToggle.setAttribute('aria-keyshortcuts', collapsed ? 'Alt+ArrowDown' : 'Alt+ArrowUp');
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

        // A tab that isn't ready (loading or failed) holds no items.
        if (this.tabs.in.items.length > 0) {
            return 'in';
        }
        if (this.tabs.out.items.length > 0) {
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
                // Linked notes rather than rows, so the count doesn't change as groups expand or collapse.
                countEl.textContent = tab.state === 'ready' ? String(countLinkedNotes(tab.items)) : '';
            }
        });
    }

    private handleTabClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.backlinks-navigator-collapse-toggle')) {
            this.setCollapsed(!this.settings.collapseDetails);
            this.input.focus();
            return;
        }
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
        this.overlay.mount();
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

    /**
     * Rebuilds the visible rows from the active tab's links and the filter. A selection that is
     * no longer visible moves to the first row of the same note (e.g. a nested row's header after
     * collapsing), else to the first row.
     */
    private applyFilter(filterText: string): void {
        this.filterText = filterText.trim();
        const model = this.activeModel;
        const previousNoteId = this.rows.find((row) => row.id === this.selectedId)?.noteId;
        const links = model.state === 'ready' ? fuzzyFilter(this.filterText, model.items) : [];
        this.rows = buildPanelRows(links, this.settings.collapseDetails);

        if (!this.rows.some((row) => row.id === this.selectedId)) {
            const fallback = this.rows.find((row) => row.noteId === previousNoteId) ?? this.rows[0];
            this.selectedId = fallback?.id ?? null;
        }

        this.render();
    }

    private handleKeyDown(event: KeyboardEvent): void {
        // Alt+Down shows details and Alt+Up hides them, as Alt+Down opens and Alt+Up closes a
        // dropdown. Alt+Left/Right would take over word-by-word caret movement on macOS (⌥←/→);
        // Up/Down already belong to the list, so their Alt variants cost the filter nothing.
        if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            this.setCollapsed(event.key === 'ArrowUp');
            return;
        }
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
        if (!this.rows.length) {
            return;
        }
        const currentIndex = this.rows.findIndex((row) => row.id === this.selectedId);
        const count = this.rows.length;
        // Double modulo wraps any delta, including negative ones, into the nonempty list.
        const nextIndex = currentIndex >= 0 ? (((currentIndex + delta) % count) + count) % count : 0;
        this.selectedId = this.rows[nextIndex]!.id;
        this.updateSelection();
        this.scrollActiveItemIntoView();
    }

    private confirmSelection(useCtrlEnterBehavior: boolean): void {
        if (!this.selectedId) {
            return;
        }
        const row = this.rows.find((candidate) => candidate.id === this.selectedId);
        if (row) {
            const link = linkForRow(row, this.settings.collapseDetails);
            if (useCtrlEnterBehavior) {
                this.refocusInputAfter(this.onCtrlEnterSelect(link));
            } else {
                this.onSelect(link);
            }
        }
    }

    private handleListClick(event: MouseEvent): void {
        const row = this.findRowForMouseEvent(event);
        if (row) {
            const link = linkForRow(row, this.settings.collapseDetails);
            this.selectedId = row.id;
            this.updateSelection();
            if (event.ctrlKey) {
                this.refocusInputAfter(this.onCtrlClickSelect(link));
            } else {
                this.onSelect(link);
            }
        }
    }

    private handleListAuxClick(event: MouseEvent): void {
        if (event.button !== 1) {
            return;
        }

        const row = this.findRowForMouseEvent(event);
        if (row) {
            this.selectedId = row.id;
            this.updateSelection();
            this.refocusInputAfter(this.onMiddleClickSelect(linkForRow(row, this.settings.collapseDetails)));
        }
    }

    /**
     * Chromium starts middle-click autoscroll on `mousedown` over a scrollable element, and the list
     * scrolls — cancelling it there is the only chance, as the `auxclick` that drives the actual
     * navigation fires too late. `preventDefault` keeps focus on the filter, so Chromium's Linux
     * primary-selection paste on mouseup lands there — blur it and let navigation restore focus.
     */
    private handleListMouseDown(event: MouseEvent): void {
        if (event.button === 1) {
            event.preventDefault();
            if (this.findRowForMouseEvent(event)) {
                this.input.blur();
            }
        }
    }

    private findRowForMouseEvent(event: MouseEvent): PanelRow | undefined {
        const target = event.target as HTMLElement | null;
        const id = target?.closest<HTMLLIElement>('.backlinks-navigator-item')?.dataset.rowId;
        return id ? this.rows.find((row) => row.id === id) : undefined;
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
        if (!this.rows.length) {
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
        for (const row of this.rows) {
            fragment.appendChild(this.createItem(row));
        }
        this.list.replaceChildren(fragment);
    }

    private createItem(row: PanelRow): HTMLLIElement {
        const item = document.createElement('li');
        item.className = 'backlinks-navigator-item';
        item.dataset.rowId = row.id;
        item.classList.toggle('is-selected', row.id === this.selectedId);

        if (row.kind === 'group') {
            // Every row of a group shares its note, so the first stands in for the header.
            const [first] = row.items;
            item.appendChild(this.createItemHeader(first, row.items.length));
            appendGroupDetails(item, first, this.settings);
            markTrashed(item, first);
            return item;
        }

        const { link } = row;
        markTrashed(item, link);
        if (row.nested) {
            item.classList.add('is-nested');
            appendLinkDetails(item, link, this.settings, true);
            return item;
        }
        item.appendChild(this.createItemHeader(link));
        appendLinkDetails(item, link, this.settings, false);
        return item;
    }

    /**
     * The title line shared by group headers and unnested rows: the note's title (with filter
     * matches highlighted), its notebook, and — for a group of several — how many links it holds.
     */
    private createItemHeader(link: LinkItem, linkCount?: number): HTMLDivElement {
        const header = document.createElement('div');
        header.className = 'backlinks-navigator-item-header';

        const title = document.createElement('span');
        title.className = 'backlinks-navigator-item-title';
        title.appendChild(highlightMatch(link.title, this.filterText));
        header.appendChild(title);

        const location = link.direction === 'out' && link.isTrashed ? 'Trash' : link.notebookName;
        if (location) {
            const notebook = document.createElement('span');
            notebook.className = 'backlinks-navigator-item-notebook';
            notebook.textContent = location;
            header.appendChild(notebook);
        }

        if (linkCount !== undefined) {
            const count = document.createElement('span');
            count.className = 'backlinks-navigator-item-count';
            count.textContent = String(linkCount);
            count.title = formatGroupCountTooltip(link.direction, linkCount);
            header.appendChild(count);
        }

        return header;
    }

    private updateSelection(): void {
        const items = this.list.querySelectorAll<HTMLLIElement>('.backlinks-navigator-item');
        items.forEach((item) => {
            item.classList.toggle('is-selected', item.dataset.rowId === this.selectedId);
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
    // Keyed on dimensions alone, since CSS variables handle theme changes automatically.
    const dimensions = settings.dimensions;
    const signature = [dimensions.width, dimensions.maxHeightPercentage].join('|');
    ensureOverlayStyles(view, PANEL_STYLE_ID, () => createPanelCss(dimensions), signature);
}

/** Marks a row whose outgoing target note is in the trash. */
function markTrashed(item: HTMLLIElement, link: LinkItem): void {
    item.classList.toggle('is-trashed', link.direction === 'out' && link.isTrashed);
}

/**
 * Appends a group header's context line when details are expanded. An outgoing header stands for
 * the target note as a whole, so it previews the note's opening. A backlink header doesn't: its
 * source note's context is in the occurrences nested beneath it, and repeating one would mislead.
 */
function appendGroupDetails(item: HTMLLIElement, link: LinkItem, settings: PanelSettings): void {
    if (!settings.collapseDetails && link.direction === 'out' && link.noteOpening) {
        appendDetailLine(item, 'backlinks-navigator-item-snippet', link.noteOpening);
    }
}

/**
 * Appends a link's context lines when details are expanded. When collapsed, single-link rows stay
 * title-only so the entire list is a uniform one-line-per-note view.
 *
 * When expanded, every row shows its snippet, outgoing anchors always name their heading, and
 * backlinks show their nearest heading when enabled. A nested backlink whose snippet is empty
 * (e.g. a bare `[](:/id)` line) falls back to its heading, then to its position, rather than
 * rendering an empty row.
 */
function appendLinkDetails(item: HTMLLIElement, link: LinkItem, settings: PanelSettings, nested: boolean): void {
    if (settings.collapseDetails) {
        return;
    }
    // An outgoing row that targets an anchor always names it: it shares its title with the row for
    // the note itself, so the heading is what tells them apart.
    const showSection =
        (link.direction === 'in' && settings.showBacklinkHeading) || (link.direction === 'out' && Boolean(link.anchor));
    const hasSnippet = Boolean(link.snippet);

    if (link.section && (showSection || (nested && !hasSnippet))) {
        appendDetailLine(item, 'backlinks-navigator-item-section', `§ ${link.section}`);
    } else if (nested && !hasSnippet && link.direction === 'in') {
        appendDetailLine(item, 'backlinks-navigator-item-snippet', `Link ${link.occurrenceIndex + 1}`);
    }
    if (hasSnippet) {
        appendDetailLine(item, 'backlinks-navigator-item-snippet', link.snippet);
    }
}

/** Tooltip for a group's count, which always covers two or more links. */
function formatGroupCountTooltip(direction: LinkDirection, count: number): string {
    return `${count} ${direction === 'in' ? 'backlinks' : 'links'}`;
}

function appendDetailLine(item: HTMLLIElement, className: string, text: string): void {
    const line = document.createElement('span');
    line.className = className;
    line.textContent = text;
    item.appendChild(line);
}
