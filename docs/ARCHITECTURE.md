# Architecture

Backlinks Navigator shows a floating popup **inside the CodeMirror 6 markdown editor**
listing every note that links to the current note. Clicking an entry navigates to that
note. It deliberately does **not** use Joplin's panel/webview API — the UI is a `<div>`
mounted into the editor's scroll DOM.

## Two execution contexts

- **Plugin host** (`src/index.ts` and its helpers) — runs with full Joplin API access.
  Registers the content script, the `Show Backlinks` command, the toolbar button, the Edit
  menu item, and settings. It answers messages from the content script.
- **Content script** (`src/contentScripts/`) — runs in the editor with CodeMirror access but
  no Joplin API. It reads the current note id, renders the panel, and asks the host for data
  and navigation.

The host has Data API access; the content script has the editor. They communicate over
Joplin's `postMessage` bridge.

## Messaging (request/response)

`context.postMessage(...)` resolves to whatever the host's `onMessage` handler returns, so
this plugin uses real request/response (see `src/messages.ts`):

- `{ type: 'getBacklinks', noteId }` → host returns `BacklinkItem[]`.
- `{ type: 'getIndicatorState', noteId }` → host returns `{ enabled: false }` when the
  "show indicator" setting is off (no search performed), otherwise `{ enabled: true, backlinks }`.
- `{ type: 'openNote', noteId }` → host runs `openItem` navigation, returns `void`.
- `{ type: 'openPanel' }` → host runs the `Show Backlinks` command (so the panel opens with the
  configured dimensions and correct mobile flag), returns `void`.

## Backlink discovery (host)

`src/backlinksService.ts`:

1. Paginate `joplin.data.get(['search'], { query: noteId, fields: [...] })`. A 32-char note
   id is a single FTS token, so this returns candidate linking notes.
2. Verify each candidate's body actually contains `:/<noteId>` (drops loose FTS matches) and
   create one backlink row for each matching occurrence, using that occurrence's line as the
   context snippet.
3. Resolve each note's parent notebook title (cached per call).
4. Sort by title, then occurrence order within each note.

Navigation uses `joplin.commands.execute('openItem', ':/' + noteId)`.

## Panel lifecycle (content script)

- `src/contentScripts/backlinksNavigator.ts` — reads the note id from
  `editorControl.joplinExtensions.noteIdFacet`, registers the `togglePanel` editor command,
  opens the panel in a loading state, fetches backlinks, and forwards clicks to the host. A
  monotonic request token prevents a slow response from populating a stale/closed panel.
  When a backlink is selected it records a "pending scroll" (the target note id, the
  `:/<currentNoteId>` needle, and the selected occurrence index) before navigating; once the
  target note loads it scrolls to that occurrence. The same `EditorView` is reused across note
  switches on desktop, so this closure state survives navigation; a short retry handles the gap
  before the new content settles.
- `src/contentScripts/ui/backlinksPanel.ts` — the floating panel UI: filter input, fuzzy
  filtering, keyboard navigation (arrows/Tab/Enter/Escape), and loading/empty/error states.
- `src/contentScripts/ui/backlinkIndicator.ts` — an optional clickable badge (icon + count)
  floated in the editor's top-right when the current note has backlinks. Gated by the
  "show indicator" setting (default off). On note load the entry sends `getIndicatorState`
  (debounced); when enabled it caches the result so the badge shows the count and clicking it
  (`openPanel`) opens the panel instantly from cache. The badge hides while the panel is open
  (same corner) and clears on note switch.
- `src/contentScripts/ui/noteIdWatcher.ts` — a transaction extender that reports note-id
  changes (note switch); the entry uses it to close the panel and trigger the pending scroll.
- `src/contentScripts/theme/panelTheme.ts` — CSS using `var(--joplin-*)` theme variables,
  injected as a single `<style>` element.

## Build

`npm run dist` runs three webpack passes (main, extra scripts, archive). The content script
entry is declared in `plugin.config.json` (`extraScripts`) and registered in
`src/manifest.json` (`content_scripts`). CodeMirror/Lezer modules are treated as externals —
Joplin provides them at runtime.
