// Flat config (ESM). Adds ignores, Node globals, typed linting, and TS-friendly rule tweaks.

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import importPlugin from 'eslint-plugin-import-x';
import sonarjs from 'eslint-plugin-sonarjs';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig(
    {
        ignores: ['api/**', 'dist/**'],
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
            import: importPlugin,
        },
        rules: {
            // Turn off rules TypeScript handles (prevents NodeJS / type-only false positives)
            'no-undef': 'off',
            // report an error if any circular dependency is found
            'import/no-cycle': ['error', { maxDepth: Infinity }],
            'no-useless-escape': 'off',
            '@typescript-eslint/no-inferrable-types': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
        },
    },

    // Vitest test files
    {
        files: ['**/*.test.ts'],
        extends: [vitest.configs.recommended],
        languageOptions: {
            globals: {
                ...vitest.environments.env.globals,
            },
        },
        rules: {
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
