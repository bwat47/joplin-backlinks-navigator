import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const apiDir = fileURLToPath(new URL('./api/', import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^api\/(.*)$/,
                replacement: `${apiDir}$1`,
            },
            {
                find: /^api$/,
                replacement: `${apiDir}index.ts`,
            },
        ],
    },
    test: {
        environment: 'jsdom',
        globals: true,
    },
});
