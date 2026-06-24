import { Compartment, Facet, type EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ContentScriptContext } from 'api/types';
import type { ContentScriptSettings, PanelSettings } from '../types';
import { DEFAULT_LINK_PREVIEW_SETTINGS, DEFAULT_PANEL_DIMENSIONS, isLinkPreviewMode } from '../types';
import { normalizePanelDimensions } from '../panelDimensions';
import type { ContentScriptToPluginMessage, GetContentScriptSettingsResponse } from '../messages';
import logger from '../logger';

export const DEFAULT_CONTENT_SCRIPT_SETTINGS: ContentScriptSettings = {
    panel: {
        dimensions: normalizePanelDimensions(DEFAULT_PANEL_DIMENSIONS),
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

function normalizePanelSettings(value: unknown): PanelSettings {
    if (!value || typeof value !== 'object') {
        return DEFAULT_CONTENT_SCRIPT_SETTINGS.panel;
    }

    const candidate = value as Partial<PanelSettings>;
    const preview =
        candidate.preview && typeof candidate.preview === 'object'
            ? (candidate.preview as { in?: unknown; out?: unknown })
            : {};
    const inPreview = isLinkPreviewMode(preview.in, true) ? preview.in : DEFAULT_LINK_PREVIEW_SETTINGS.in;
    const outPreview = isLinkPreviewMode(preview.out, false) ? preview.out : DEFAULT_LINK_PREVIEW_SETTINGS.out;

    return {
        dimensions: normalizePanelDimensions(candidate.dimensions),
        preview: {
            in: inPreview,
            out: outPreview,
        },
    };
}

export function normalizeContentScriptSettings(value: unknown): ContentScriptSettings {
    if (!value || typeof value !== 'object') {
        return DEFAULT_CONTENT_SCRIPT_SETTINGS;
    }

    const candidate = value as Partial<ContentScriptSettings>;
    return {
        panel: normalizePanelSettings(candidate.panel),
        showIndicator: typeof candidate.showIndicator === 'boolean' ? candidate.showIndicator : false,
    };
}

export function createSettingsExtension(): Extension {
    return settingsCompartment.of(settingsFacet.of(DEFAULT_CONTENT_SCRIPT_SETTINGS));
}

export function applyContentScriptSettings(view: EditorView, settings: unknown): ContentScriptSettings {
    const normalized = normalizeContentScriptSettings(settings);
    view.dispatch({
        effects: settingsCompartment.reconfigure(settingsFacet.of(normalized)),
    });
    return normalized;
}

export async function syncInitialContentScriptSettings(context: ContentScriptContext, view: EditorView): Promise<void> {
    try {
        const response = (await context.postMessage({
            type: 'getContentScriptSettings',
        } as ContentScriptToPluginMessage)) as GetContentScriptSettingsResponse;
        applyContentScriptSettings(view, response);
    } catch (error) {
        logger.warn('Failed to fetch content script settings', error);
    }
}
