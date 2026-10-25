// Flat config (ESM). Adds ignores, Node globals, typed linting, and TS-friendly rule tweaks.

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import importPlugin from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import sonarjs from 'eslint-plugin-sonarjs';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Type-only imports are erased at build time, so they may cross these boundaries.
const hostApiMessage = 'The Joplin plugin API is only available in src/host and src/index.ts.';
const apiPaths = [
    { name: 'api', message: hostApiMessage, allowTypeImports: true },
    { name: 'api/types', message: hostApiMessage, allowTypeImports: true },
];

export default defineConfig(
    {
        ignores: ['api/**', 'dist/**', 'webpack.config.js', '.prettierrc.js'],
    },

    js.configs.recommended,
    sonarjs.configs.recommended,

    // Project TS/JS sources
    {
        files: ['**/*.{ts,tsx,js}'],
        extends: [tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            'import-x': importPlugin,
        },
        settings: {
            // Without these, import-x silently skips TS imports and rules like no-cycle never fire.
            // Resolve imports the way tsc does (.ts extensions, tsconfig paths)...
            'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
            // ...and parse resolved .ts files when following the import graph.
            'import-x/extensions': ['.ts', '.tsx', '.js'],
            'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
        },
        rules: {
            // report an error if any circular dependency is found
            'import-x/no-cycle': 'error',
            'import-x/no-self-import': 'error',
            // Merge duplicate imports using inline `type` specifiers, matching consistent-type-imports below
            'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            // Use `import type { A }` rather than `import { type A }` when every specifier is a type
            '@typescript-eslint/no-import-type-side-effects': 'error',
            // Redundant with TypeScript's own no-overlap check (TS2367), and misfires on union types
            'sonarjs/different-types-comparison': 'off',
            '@typescript-eslint/no-inferrable-types': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
        },
    },

    // Runtime boundaries. Later blocks replace (not merge) rule options, so contentScripts repeats apiPaths.
    {
        files: ['src/**/*.ts'],
        ignores: ['src/index.ts', 'src/host/**'],
        rules: {
            'no-restricted-imports': ['error', { paths: apiPaths }],
        },
    },
    {
        files: ['src/contentScripts/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: apiPaths,
                    patterns: [
                        {
                            regex: '^(\\.\\./)+host/',
                            message: 'Content scripts run in the editor and cannot import host code.',
                            allowTypeImports: true,
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/host/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^(\\.\\./)+contentScripts/',
                            message: 'Host code cannot import code bundled for the editor content scripts.',
                            allowTypeImports: true,
                        },
                    ],
                },
            ],
        },
    },

    // Vitest test files
    {
        files: ['**/*.test.ts'],
        extends: [vitest.configs.recommended],
        rules: {
            // Vitest globals are disabled; import test APIs explicitly from 'vitest'
            'vitest/prefer-importing-vitest-globals': 'error',
            // Vitest-aware version that allows passing methods to expect()
            '@typescript-eslint/unbound-method': 'off',
            'vitest/unbound-method': 'error',
            // Async mock implementations intentionally return promises without awaiting
            '@typescript-eslint/require-await': 'off',
        },
    },

    // Prettier compatibility
    prettier
);
