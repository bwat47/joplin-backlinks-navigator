import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PANEL_DIMENSIONS, type Backlink, type LinkItem, type PanelSettings } from '../../types';
import { BacklinksPanel, type PanelCallbacks } from './backlinksPanel';

class FakeResizeObserver {
    public observe(): void {}

    public disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', FakeResizeObserver);

function createView(): EditorView {
    const dom = document.createElement('div');
    const scrollRoot = document.createElement('div');
    const scrollDOM = document.createElement('div');
    const contentDOM = document.createElement('div');
    dom.appendChild(scrollRoot);
    scrollRoot.appendChild(scrollDOM);
    scrollDOM.appendChild(contentDOM);
    document.body.appendChild(dom);

    return { dom, scrollDOM, contentDOM } as unknown as EditorView;
}

function computedPanelFont(): string {
    return getComputedStyle(document.querySelector('.backlinks-navigator-panel')!).fontFamily;
}

const SETTINGS: PanelSettings = {
    dimensions: DEFAULT_PANEL_DIMENSIONS,
    showBacklinkHeading: false,
    collapseDetails: false,
};

function createCallbacks(): PanelCallbacks {
    return {
        onSelect: vi.fn(),
        onCtrlClickSelect: vi.fn(),
        onCtrlEnterSelect: vi.fn(),
        onMiddleClickSelect: vi.fn(),
        onClose: vi.fn(),
        onCollapseChange: vi.fn(),
    };
}

function createPanelHarness(
    isMobile = false,
    settings: PanelSettings = SETTINGS
): { panel: BacklinksPanel; callbacks: PanelCallbacks } {
    const callbacks = createCallbacks();
    const panel = new BacklinksPanel(createView(), callbacks, settings, isMobile);
    panel.open();
    return { panel, callbacks };
}

function createPanel(isMobile = false): BacklinksPanel {
    return createPanelHarness(isMobile).panel;
}

const LINK: LinkItem = {
    direction: 'in',
    id: 'link-1',
    noteId: 'note-1',
    occurrenceIndex: 0,
    title: 'Linked note',
    notebookName: 'Notebook',
    section: '',
    snippet: 'Link context',
};

function openContextMenu(): MouseEvent {
    const input = document.querySelector<HTMLInputElement>('.backlinks-navigator-input')!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event;
}

describe('BacklinksPanel filter context menu', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        document.head.replaceChildren();
    });

    it('suppresses the desktop context menu', () => {
        const panel = createPanel();

        const event = openContextMenu();

        expect(event.defaultPrevented).toBe(true);
        panel.destroy();
    });

    it('leaves the mobile context menu enabled', () => {
        const panel = createPanel(true);

        const event = openContextMenu();

        expect(event.defaultPrevented).toBe(false);
        panel.destroy();
    });
});

describe('BacklinksPanel editor font', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        document.head.replaceChildren();
    });

    it('uses the editor content font and refreshes it on each open', () => {
        const view = createView();
        const panel = new BacklinksPanel(view, createCallbacks(), SETTINGS);

        view.contentDOM.style.fontFamily = '"Editor Font", serif';
        panel.open();
        expect(computedPanelFont()).toBe(getComputedStyle(view.contentDOM).fontFamily);
        expect(computedPanelFont()).toContain('Editor Font');

        view.contentDOM.style.fontFamily = '"Other Font", sans-serif';
        panel.open();
        expect(computedPanelFont()).toContain('Other Font');
        panel.destroy();
    });
});

describe('BacklinksPanel middle-click navigation', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        document.head.replaceChildren();
    });

    it('uses the middle-click callback for a link row', () => {
        const { panel, callbacks } = createPanelHarness();
        panel.setLinks('in', [LINK]);
        const item = document.querySelector<HTMLLIElement>('.backlinks-navigator-item')!;
        item.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));

        expect(callbacks.onMiddleClickSelect).toHaveBeenCalledWith(LINK);
        expect(callbacks.onSelect).not.toHaveBeenCalled();
        expect(callbacks.onCtrlClickSelect).not.toHaveBeenCalled();
        panel.destroy();
    });

    it('suppresses middle-button mousedown and blurs the filter', () => {
        const { panel } = createPanelHarness();
        panel.setLinks('in', [LINK]);
        const input = document.querySelector<HTMLInputElement>('.backlinks-navigator-input')!;
        const item = document.querySelector<HTMLLIElement>('.backlinks-navigator-item')!;
        const middle = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
        const primary = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });

        input.focus();
        item.dispatchEvent(middle);
        item.dispatchEvent(primary);

        expect(middle.defaultPrevented).toBe(true);
        expect(primary.defaultPrevented).toBe(false);
        expect(document.activeElement).not.toBe(input);
        panel.destroy();
    });

    it('keeps the filter focused when middle-button mousedown is outside a link row', () => {
        const { panel } = createPanelHarness();
        const input = document.querySelector<HTMLInputElement>('.backlinks-navigator-input')!;
        const list = document.querySelector<HTMLUListElement>('.backlinks-navigator-list')!;
        const middle = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });

        input.focus();
        list.dispatchEvent(middle);

        expect(middle.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input);
        panel.destroy();
    });

    it('ignores other auxiliary mouse buttons', () => {
        const { panel, callbacks } = createPanelHarness();
        panel.setLinks('in', [LINK]);
        const item = document.querySelector<HTMLLIElement>('.backlinks-navigator-item')!;

        item.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }));

        expect(callbacks.onMiddleClickSelect).not.toHaveBeenCalled();
        panel.destroy();
    });
});

describe('BacklinksPanel trashed outgoing links', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        document.head.replaceChildren();
    });

    it('labels a trashed target as Trash and marks the row', () => {
        const panel = createPanel();
        panel.setLinks('in', []);
        panel.setLinks('out', [
            {
                direction: 'out',
                id: 'trashed',
                noteId: 'note-2',
                anchor: '',
                title: 'Trashed note',
                notebookName: '',
                section: '',
                snippet: '',
                noteOpening: '',
                isTrashed: true,
            },
        ]);

        const item = document.querySelector<HTMLLIElement>('.backlinks-navigator-item')!;
        expect(item.classList.contains('is-trashed')).toBe(true);
        expect(item.querySelector('.backlinks-navigator-item-notebook')?.textContent).toBe('Trash');
        panel.destroy();
    });

    it('leaves rows in a notebook unmarked', () => {
        const panel = createPanel();
        panel.setLinks('in', [LINK]);

        const item = document.querySelector<HTMLLIElement>('.backlinks-navigator-item')!;
        expect(item.classList.contains('is-trashed')).toBe(false);
        expect(item.querySelector('.backlinks-navigator-item-notebook')?.textContent).toBe('Notebook');
        panel.destroy();
    });
});

function occurrence(noteId: string, occurrenceIndex: number, snippet = `occurrence ${occurrenceIndex}`): Backlink {
    return {
        direction: 'in',
        id: `${noteId}:${occurrenceIndex}`,
        noteId,
        occurrenceIndex,
        title: `Note ${noteId}`,
        notebookName: 'Notebook',
        section: '',
        snippet,
    };
}

const rowIds = (): (string | undefined)[] =>
    [...document.querySelectorAll<HTMLLIElement>('.backlinks-navigator-item')].map((item) => item.dataset.rowId);

const selectedRowId = (): string | undefined =>
    document.querySelector<HTMLLIElement>('.backlinks-navigator-item.is-selected')?.dataset.rowId;

const pressKey = (key: string, init: KeyboardEventInit = {}): void => {
    document
        .querySelector<HTMLInputElement>('.backlinks-navigator-input')!
        .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

describe('BacklinksPanel grouping', () => {
    const LINKS = [occurrence('a', 0), occurrence('a', 1), occurrence('b', 0)];

    beforeEach(() => {
        document.body.replaceChildren();
        document.head.replaceChildren();
    });

    it('nests a note’s occurrences under a header that shows their count', () => {
        const { panel } = createPanelHarness();
        panel.setLinks('in', LINKS);

        expect(rowIds()).toEqual(['group:a', 'a:0', 'a:1', 'b:0']);
        const header = document.querySelector('[data-row-id="group:a"]')!;
        const count = header.querySelector<HTMLSpanElement>('.backlinks-navigator-item-count')!;
        expect(count.textContent).toBe('2');
        expect(count.title).toBe('2 backlinks');
        expect(header.querySelector('.backlinks-navigator-item-snippet')).toBeNull();
        const nested = document.querySelector('[data-row-id="a:1"]')!;
        expect(nested.classList.contains('is-nested')).toBe(true);
        expect(nested.querySelector('.backlinks-navigator-item-title')).toBeNull();
        expect(nested.textContent).toBe('occurrence 1');
        panel.destroy();
    });

    it('counts linked notes in the tab, not occurrences', () => {
        const { panel } = createPanelHarness();
        panel.setLinks('in', LINKS);

        expect(document.querySelector('[data-tab="in"] .backlinks-navigator-tab-count')?.textContent).toBe('2');
        panel.destroy();
    });

    it('falls back to the heading, then the position, for a nested occurrence with no snippet', () => {
        const { panel } = createPanelHarness();
        panel.setLinks('in', [{ ...occurrence('a', 0, ''), section: 'Intro' }, occurrence('a', 1, '')]);

        expect(document.querySelector('[data-row-id="a:0"]')?.textContent).toBe('§ Intro');
        expect(document.querySelector('[data-row-id="a:1"]')?.textContent).toBe('Link 2');
        panel.destroy();
    });

    it('shows nearest heading on single-link and nested backlinks when enabled and expanded', () => {
        const { panel } = createPanelHarness(false, { ...SETTINGS, showBacklinkHeading: true });
        panel.setLinks('in', [
            { ...occurrence('a', 0), section: 'Intro' },
            { ...occurrence('a', 1), section: 'Details' },
            { ...occurrence('b', 0), section: 'Summary' },
        ]);

        expect(document.querySelector('[data-row-id="a:1"] .backlinks-navigator-item-section')?.textContent).toBe(
            '§ Details'
        );
        expect(document.querySelector('[data-row-id="b:0"] .backlinks-navigator-item-section')?.textContent).toBe(
            '§ Summary'
        );
        panel.destroy();
    });

    it('hides nested rows, snippets, and headings when collapsed', () => {
        const { panel } = createPanelHarness(false, { ...SETTINGS, showBacklinkHeading: true, collapseDetails: true });
        panel.setLinks('in', [
            { ...occurrence('a', 0), section: 'Intro' },
            { ...occurrence('a', 1), section: 'Details' },
            { ...occurrence('b', 0), section: 'Summary' },
        ]);

        expect(rowIds()).toEqual(['group:a', 'b:0']);
        expect(document.querySelector('[data-row-id="b:0"] .backlinks-navigator-item-snippet')).toBeNull();
        expect(document.querySelector('[data-row-id="b:0"] .backlinks-navigator-item-section')).toBeNull();
        expect(document.querySelector('[data-row-id="group:a"] .backlinks-navigator-item-snippet')).toBeNull();
        panel.destroy();
    });

    it('collapses from the toggle, reports the choice, and moves a hidden selection to its header', () => {
        const { panel, callbacks } = createPanelHarness();
        panel.setLinks('in', LINKS);
        pressKey('ArrowDown');
        pressKey('ArrowDown');
        expect(selectedRowId()).toBe('a:1');

        document.querySelector<HTMLButtonElement>('.backlinks-navigator-collapse-toggle')!.click();

        expect(callbacks.onCollapseChange).toHaveBeenCalledWith(true);
        expect(rowIds()).toEqual(['group:a', 'b:0']);
        expect(selectedRowId()).toBe('group:a');
        panel.destroy();
    });

    it('keeps the details toggle visible and hides/restores snippets on single-link rows', () => {
        const { panel, callbacks } = createPanelHarness();
        const toggle = document.querySelector<HTMLButtonElement>('.backlinks-navigator-collapse-toggle')!;

        // Empty/loading: button stays in the tab bar (no layout shift)
        expect(toggle.hidden).toBe(false);

        panel.setLinks('in', [occurrence('b', 0)]);
        expect(document.querySelector('[data-row-id="b:0"] .backlinks-navigator-item-snippet')?.textContent).toBe(
            'occurrence 0'
        );
        toggle.click();
        expect(document.querySelector('[data-row-id="b:0"] .backlinks-navigator-item-snippet')).toBeNull();
        toggle.click();
        expect(document.querySelector('[data-row-id="b:0"] .backlinks-navigator-item-snippet')?.textContent).toBe(
            'occurrence 0'
        );
        expect(vi.mocked(callbacks.onCollapseChange).mock.calls).toEqual([[true], [false]]);
        panel.destroy();
    });

    it('skips re-rendering rows when pushed settings do not change row display', () => {
        const { panel } = createPanelHarness();
        panel.setLinks('in', LINKS);
        const header = document.querySelector('[data-row-id="group:a"]');

        panel.setSettings({ ...SETTINGS, dimensions: { ...SETTINGS.dimensions, width: 400 } });
        expect(document.querySelector('[data-row-id="group:a"]')).toBe(header);

        // Changing a row-affecting setting still re-renders.
        panel.setSettings({ ...SETTINGS, showBacklinkHeading: true });
        expect(document.querySelector('[data-row-id="group:a"]')).not.toBe(header);
        panel.destroy();
    });

    it('hides details with Alt+Up and shows them with Alt+Down, without moving the selection', () => {
        const { panel, callbacks } = createPanelHarness();
        panel.setLinks('in', LINKS);
        const toggle = document.querySelector<HTMLButtonElement>('.backlinks-navigator-collapse-toggle')!;
        expect(toggle.title).toBe('Hide details (Alt+↑)');
        expect(toggle.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp');

        pressKey('ArrowUp', { altKey: true });
        expect(rowIds()).toEqual(['group:a', 'b:0']);
        expect(selectedRowId()).toBe('group:a');
        expect(toggle.title).toBe('Show details (Alt+↓)');
        expect(toggle.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowDown');

        // Repeating the key in its current direction does nothing.
        pressKey('ArrowUp', { altKey: true });
        pressKey('ArrowDown', { altKey: true });
        expect(rowIds()).toEqual(['group:a', 'a:0', 'a:1', 'b:0']);
        expect(selectedRowId()).toBe('group:a');
        expect(vi.mocked(callbacks.onCollapseChange).mock.calls).toEqual([[true], [false]]);
        panel.destroy();
    });

    it('cancels a pending filter debounce when toggling details applies the filter immediately', () => {
        vi.useFakeTimers();
        try {
            const { panel } = createPanelHarness();
            panel.setLinks('in', LINKS);
            const input = document.querySelector<HTMLInputElement>('.backlinks-navigator-input')!;
            input.value = 'Note a';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            pressKey('ArrowUp', { altKey: true });
            const header = document.querySelector('[data-row-id="group:a"]');
            expect(rowIds()).toEqual(['group:a']);

            vi.advanceTimersByTime(100);
            expect(document.querySelector('[data-row-id="group:a"]')).toBe(header);
            panel.destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('flushes a pending filter debounce before confirming with Enter', () => {
        vi.useFakeTimers();
        try {
            const { panel, callbacks } = createPanelHarness();
            panel.setLinks('in', LINKS);
            const input = document.querySelector<HTMLInputElement>('.backlinks-navigator-input')!;
            input.value = 'Note b';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            pressKey('Enter');

            expect(callbacks.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'b:0', noteId: 'b' }));
            panel.destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('selects the top match when a filter query reorders the same rows', () => {
        vi.useFakeTimers();
        try {
            const { panel } = createPanelHarness();
            panel.setLinks('in', [
                { ...occurrence('a', 0), title: '6.4.9.0 System Test - Main' },
                { ...occurrence('b', 0), title: 'Test' },
            ]);
            expect(rowIds()).toEqual(['a:0', 'b:0']);
            expect(selectedRowId()).toBe('a:0');

            const input = document.querySelector<HTMLInputElement>('.backlinks-navigator-input')!;
            input.value = 'Test';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            vi.advanceTimersByTime(100);

            expect(rowIds()).toEqual(['b:0', 'a:0']);
            expect(selectedRowId()).toBe('b:0');
            panel.destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the filter focused when clicking the already-active tab', () => {
        const { panel } = createPanelHarness();
        panel.setLinks('in', LINKS);
        const input = document.querySelector<HTMLInputElement>('.backlinks-navigator-input')!;
        const activeTab = document.querySelector<HTMLButtonElement>('[data-tab="in"]')!;

        activeTab.focus();
        activeTab.click();

        expect(document.activeElement).toBe(input);
        panel.destroy();
    });

    it('follows a pushed collapse choice without reporting it as a toggle', () => {
        const { panel, callbacks } = createPanelHarness();
        panel.setLinks('in', LINKS);
        const toggle = document.querySelector<HTMLButtonElement>('.backlinks-navigator-collapse-toggle')!;

        panel.setSettings({ ...SETTINGS, collapseDetails: true });

        expect(rowIds()).toEqual(['group:a', 'b:0']);
        expect(toggle.getAttribute('aria-label')).toBe('Show details');
        expect(callbacks.onCollapseChange).not.toHaveBeenCalled();
        panel.destroy();
    });

    it('opens a header’s note without an occurrence to scroll to', () => {
        const { panel, callbacks } = createPanelHarness();
        panel.setLinks('in', [
            {
                ...occurrence('a', 0),
                navigationTarget: { from: 0, to: 1, text: 'x', contextBefore: '', contextAfter: '' },
            },
            occurrence('a', 1),
        ]);

        document.querySelector('[data-row-id="group:a"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(callbacks.onSelect).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'a' }));
        expect(vi.mocked(callbacks.onSelect).mock.calls[0]![0].navigationTarget).toBeUndefined();
        panel.destroy();
    });

    it('opens a single link’s note without scrolling in compact view', () => {
        const { panel, callbacks } = createPanelHarness(false, { ...SETTINGS, collapseDetails: true });
        panel.setLinks('in', [
            {
                ...occurrence('b', 0),
                navigationTarget: { from: 0, to: 1, text: 'x', contextBefore: '', contextAfter: '' },
            },
        ]);

        document.querySelector('[data-row-id="b:0"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(callbacks.onSelect).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'b' }));
        expect(vi.mocked(callbacks.onSelect).mock.calls[0]![0].navigationTarget).toBeUndefined();
        panel.destroy();
    });

    describe('outgoing groups', () => {
        const destination = (anchor: string): LinkItem => ({
            direction: 'out',
            id: anchor ? `a#${anchor}` : 'a',
            noteId: 'a',
            anchor,
            title: 'Note a',
            notebookName: 'Notebook',
            section: anchor ? `Heading ${anchor}` : '',
            snippet: anchor ? `Section ${anchor}` : 'Note opening',
            noteOpening: 'Note opening',
            isTrashed: false,
        });

        const showOutgoing = (settings: PanelSettings, links: LinkItem[]): BacklinksPanel => {
            const { panel } = createPanelHarness(false, settings);
            panel.setLinks('in', []);
            panel.setLinks('out', links);
            return panel;
        };

        it('nests only the anchors, counting every link in the header', () => {
            const panel = showOutgoing(SETTINGS, [destination(''), destination('setup'), destination('usage')]);

            // The header opens the note itself, so the whole-note destination gets no row of its own.
            expect(rowIds()).toEqual(['group:a', 'a#setup', 'a#usage']);
            const header = document.querySelector('[data-row-id="group:a"]')!;
            const count = header.querySelector<HTMLSpanElement>('.backlinks-navigator-item-count')!;
            expect(count.textContent).toBe('3');
            expect(count.title).toBe('3 links');
            expect(document.querySelector('[data-row-id="a#setup"]')?.textContent).toBe('§ Heading setupSection setup');
            panel.destroy();
        });

        it('counts the whole-note link when a mixed outgoing group has one anchor', () => {
            const panel = showOutgoing(SETTINGS, [destination(''), destination('setup')]);

            expect(rowIds()).toEqual(['group:a', 'a#setup']);
            expect(document.querySelector('[data-row-id="group:a"] .backlinks-navigator-item-count')?.textContent).toBe(
                '2'
            );
            panel.destroy();
        });

        it('previews the note’s opening on the header when expanded, even with only anchors linked', () => {
            const panel = showOutgoing(SETTINGS, [destination('setup'), destination('usage')]);

            expect(
                document.querySelector('[data-row-id="group:a"] .backlinks-navigator-item-snippet')?.textContent
            ).toBe('Note opening');
            panel.destroy();
        });

        it('hides nested anchors and snippets when collapsed', () => {
            const panel = showOutgoing({ ...SETTINGS, collapseDetails: true }, [
                destination(''),
                destination('setup'),
                { ...destination(''), id: 'b', noteId: 'b', title: 'Note b' },
            ]);

            expect(rowIds()).toEqual(['group:a', 'b']);
            expect(document.querySelector('[data-row-id="group:a"] .backlinks-navigator-item-snippet')).toBeNull();
            expect(document.querySelector('[data-row-id="b"] .backlinks-navigator-item-snippet')).toBeNull();
            panel.destroy();
        });
    });
});
