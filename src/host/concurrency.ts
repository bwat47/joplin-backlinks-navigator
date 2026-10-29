/**
 * How many Data API lookups one discovery pass keeps in flight. Each lookup is a round trip to the
 * Joplin main process, so running them one at a time makes a note with many links slow to resolve;
 * a small bound gets most of the speedup without flooding the bridge.
 */
export const LOOKUP_CONCURRENCY = 8;

/**
 * Maps `items` through `mapper`, running at most `limit` calls at once.
 *
 * @returns The results in input order, regardless of completion order. Rejects with the first
 *   mapper rejection; calls already running are left to settle.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    // Each worker claims the next unclaimed index until none remain. Claiming is synchronous, so no
    // two workers ever take the same item.
    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            // The synchronous claim above guarantees an in-bounds index.
            results[index] = await mapper(items[index]!, index);
        }
    };

    const workerCount = Math.min(Math.max(1, Math.floor(limit)), items.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
}
