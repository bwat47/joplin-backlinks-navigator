import { Compartment, Facet, type EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { ContentScriptContext } from 'api/types';
import { type ContentScriptSettings, DEFAULT_LINK_PREVIEW_SETTINGS, DEFAULT_PANEL_DIMENSIONS } from '../../types';
import { request } from '../bridge';
import logger from '../../logger';

export const DEFAULT_CONTENT_SCRIPT_SETTINGS: ContentScriptSettings = {
    panel: {
        dimensions: { ...DEFAULT_PANEL_DIMENSIONS },
        preview: { ...DEFAULT_LINK_PREVIEW_SETTINGS },
    },
    showIndicator: false,
};

const settingsFacet = Facet.define<ContentScriptSettings, ContentScriptSettings>({
    combine: (values) => values[0] ?? DEFAULT_CONTENT_SCRIPT_SETTINGS,
});

const settingsCompartment = new Compartment();

export function getContentScriptSettings(state: EditorState): ContentScriptSettings {
    return state.facet(settingsFacet);
}

export function createSettingsExtension(): Extension {
    return settingsCompartment.of(settingsFacet.of(DEFAULT_CONTENT_SCRIPT_SETTINGS));
}

/**
 * Stores settings the host loaded. The host normalizes them (see `loadContentScriptSettings`), so
 * they are applied as received.
 */
export function applyContentScriptSettings(view: EditorView, settings: ContentScriptSettings): void {
    view.dispatch({
        effects: settingsCompartment.reconfigure(settingsFacet.of(settings)),
    });
}

export async function syncInitialContentScriptSettings(context: ContentScriptContext, view: EditorView): Promise<void> {
    try {
        const settings = await request(context, { type: 'getContentScriptSettings' });
        if (settings) {
            applyContentScriptSettings(view, settings);
        }
    } catch (error) {
        logger.warn('Failed to fetch content script settings', error);
    }
}
