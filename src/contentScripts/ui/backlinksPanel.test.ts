import type { EditorView } from '@codemirror/view';
import { DEFAULT_LINK_PREVIEW_SETTINGS, DEFAULT_PANEL_DIMENSIONS, type LinkItem } from '../../types';
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
    dom.appendChild(scrollRoot);
    scrollRoot.appendChild(scrollDOM);
    document.body.appendChild(dom);

    return { dom, scrollDOM } as unknown as EditorView;
}

function createPanelHarness(isMobile = false): { panel: BacklinksPanel; callbacks: PanelCallbacks } {
    const callbacks: PanelCallbacks = {
        onSelect: vi.fn(),
        onCtrlClickSelect: vi.fn(),
        onCtrlEnterSelect: vi.fn(),
        onMiddleClickSelect: vi.fn(),
        onClose: vi.fn(),
    };
    const panel = new BacklinksPanel(
        createView(),
        callbacks,
        {
            dimensions: DEFAULT_PANEL_DIMENSIONS,
            preview: DEFAULT_LINK_PREVIEW_SETTINGS,
        },
        isMobile
    );
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
    anchor: '',
    occurrenceIndex: 0,
    occurrenceCount: 1,
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
