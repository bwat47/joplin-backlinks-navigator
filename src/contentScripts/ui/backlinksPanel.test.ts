import type { EditorView } from '@codemirror/view';
import { DEFAULT_LINK_PREVIEW_SETTINGS, DEFAULT_PANEL_DIMENSIONS } from '../../types';
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

function createPanel(isMobile = false): BacklinksPanel {
    const callbacks: PanelCallbacks = {
        onSelect: vi.fn(),
        onCtrlClickSelect: vi.fn(),
        onCtrlEnterSelect: vi.fn(),
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
    return panel;
}

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
