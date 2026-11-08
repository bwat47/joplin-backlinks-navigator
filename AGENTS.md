## Project architecture overview

docs/ARCHITECTURE.md

## Joplin Data API

- `GET /folders` returns a flat, paginated `{ items, has_more }` list with `parent_id` by default. The non-paginated tree response is opt-in with `as_tree=1`; the REST API documentation is outdated on this behavior.

## Build, Test, and Development Commands

- `npm run dist` Typecheck, bundle with esbuild, and create archive at `publish/*.jpl`.
- `npm test` Run the Vitest suite, then the bundle tests (`test/*.test.mjs`).
- `npm run typecheck` Check TypeScript without producing output.
- `npm run lint` Lint TypeScript and bundle tests with ESLint.
- `npm run lint:fix` Auto-fix lint issues.
- `npm run format` Format code with Prettier.
- `npm run knip` Find unused dependencies, exports and files.
- `npm run updateVersion` Increment the patch version in package.json, src/manifest.json, and package-lock.json together.
- `npm run updateApi` Update api/ from generator-joplin without regenerating the project.

See docs/BUILDING.md for build and maintenance details.

## Design Principles

- **Simple over complex:** prefer focused, single-responsibility modules.
- **One clear way**: Avoid multiple competing approaches.
- **Separation of concerns**: Each module handles one aspect.

## Coding Style & Naming Conventions

- **Language**: TypeScript with strict settings; 4-space indentation; semicolons required.
- **Filenames**: `camelCase.ts` for modules; tests mirror names: `module.test.ts`.
- **Module boundaries**: Add explicit return types to exported functions and public methods of exported classes. Prefer named exported types for non-trivial object shapes. Let TypeScript infer local implementation details, and avoid redundant primitive annotations.
- **Style enforcement**: Run `npm run format` before commits or if you encounter formatting errors from prettier.
- **Documentation**: Use TSDoc for complex functions; document regex patterns with examples.

## Line endings

- All text files use LF. If you must fall back to a Python script for file editing, write LF explicitly
  (Python: `open(path, 'w', newline='\n')` or `write_text(..., newline='\n')`).
- Don't manually repair incidental CRLF changes. Git normalizes text to LF when staging; Prettier also normalizes files when formatting.

## Log messages

- Use `src\logger.ts` wrapper

## Git

- Use conventional commit format for commit messages
- Never run git commit proactively; always wait for explicit user consent.
- GitHub credentials are stored in the OS keyring. If `gh auth status` fails inside the sandbox, retry it with escalated permissions before asking me to authenticate.
