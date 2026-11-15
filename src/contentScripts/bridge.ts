import type { ContentScriptContext } from 'api/types';
import type { MessageOf, Protocol, ResponseFor } from '../messages';

/**
 * Sends a typed message to the plugin host and resolves with its response.
 *
 * Both sides of the bridge ship in this plugin and are typed from the same `Protocol`, so the
 * response is trusted to match it. It is `undefined` when the host had no handler for the message.
 */
export function request<K extends keyof Protocol>(
    context: ContentScriptContext,
    message: MessageOf<K>
): Promise<ResponseFor<K> | undefined> {
    // Joplin's content-script bridge, not window.postMessage, so there is no target origin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    return context.postMessage(message) as Promise<ResponseFor<K> | undefined>;
}
