import { vi, type Mock } from 'vitest';
import joplin from 'api';
import { expandIgnoredFolderIds } from './noteMetadata';

vi.mock('api', () => ({
    __esModule: true,
    default: {
        data: {
            get: vi.fn(),
        },
    },
}));

const mockDataGet = joplin.data.get as Mock;

const ROOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CHILD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const GRANDCHILD = 'cccccccccccccccccccccccccccccccc';
const UNRELATED = 'dddddddddddddddddddddddddddddddd';

describe('expandIgnoredFolderIds', () => {
    beforeEach(() => {
        mockDataGet.mockReset();
    });

    it('returns the configured set without listing notebooks when nothing is ignored', async () => {
        const configured = new Set<string>();

        await expect(expandIgnoredFolderIds(configured)).resolves.toBe(configured);
        expect(mockDataGet).not.toHaveBeenCalled();
    });

    it('collects nested descendants across paginated folder listings', async () => {
        mockDataGet.mockImplementation(async (path: string[], options?: { page?: number }) => {
            if (path[0] !== 'folders') {
                throw new Error(`Unexpected Data API request: ${path.join('/')}`);
            }
            if (options?.page === 1) {
                return {
                    items: [
                        { id: ROOT, parent_id: '' },
                        { id: CHILD, parent_id: ROOT },
                    ],
                    has_more: true,
                };
            }
            return {
                items: [
                    { id: GRANDCHILD, parent_id: CHILD },
                    { id: UNRELATED, parent_id: '' },
                ],
                has_more: false,
            };
        });

        await expect(expandIgnoredFolderIds(new Set([ROOT]))).resolves.toEqual(new Set([ROOT, CHILD, GRANDCHILD]));
        expect(mockDataGet).toHaveBeenCalledTimes(2);
    });

    it('terminates on a malformed parent cycle', async () => {
        mockDataGet.mockResolvedValue({
            items: [
                { id: ROOT, parent_id: CHILD },
                { id: CHILD, parent_id: ROOT },
            ],
            has_more: false,
        });

        await expect(expandIgnoredFolderIds(new Set([ROOT]))).resolves.toEqual(new Set([ROOT, CHILD]));
    });

    it('falls back to the configured notebooks when the folder listing fails', async () => {
        mockDataGet.mockRejectedValue(new Error('offline'));

        await expect(expandIgnoredFolderIds(new Set([ROOT]))).resolves.toEqual(new Set([ROOT]));
    });
});
