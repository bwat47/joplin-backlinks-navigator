import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency';

/** Resolves on a later macrotask, so overlapping calls really overlap. */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
    it('returns results in input order when calls finish out of order', async () => {
        const result = await mapWithConcurrency([30, 10, 20], 3, async (ms, index) => {
            await delay(ms);
            return `${index}:${ms}`;
        });

        expect(result).toEqual(['0:30', '1:10', '2:20']);
    });

    it('never runs more than the limit at once', async () => {
        let running = 0;
        let peak = 0;

        await mapWithConcurrency([5, 1, 4, 2, 3, 1, 2], 3, async (ms) => {
            running += 1;
            peak = Math.max(peak, running);
            await delay(ms);
            running -= 1;
        });

        expect(peak).toBe(3);
    });

    it('maps every item exactly once', async () => {
        const seen: number[] = [];

        await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
            seen.push(item);
            await delay(1);
        });

        expect(seen).toHaveLength(5);
        expect(new Set(seen)).toEqual(new Set([1, 2, 3, 4, 5]));
    });

    it('returns an empty list without calling the mapper', async () => {
        await expect(
            mapWithConcurrency([], 4, async () => {
                throw new Error('should not be called');
            })
        ).resolves.toEqual([]);
    });

    it('rejects when a mapper call rejects', async () => {
        await expect(
            mapWithConcurrency([1, 2, 3], 2, async (item) => {
                if (item === 2) {
                    throw new Error('lookup failed');
                }
                return item;
            })
        ).rejects.toThrow('lookup failed');
    });
});
