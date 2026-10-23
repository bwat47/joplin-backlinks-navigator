import type { ContentScriptContext } from 'api/types';
import type { MessageOf, Protocol, ResponseFor } from '../messages';

/**
 * Sends a typed message to the plugin host and resolves with its response.
 *
 * The response type is what the protocol promises, not something checked here: the value crosses
 * the postMessage bridge untyped, so callers still validate it before trusting its shape.
 */
export function request<K extends keyof Protocol>(
    context: ContentScriptContext,
    message: MessageOf<K>
): Promise<ResponseFor<K> | undefined> {
    return context.postMessage(message) as Promise<ResponseFor<K> | undefined>;
}
