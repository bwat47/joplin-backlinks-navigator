# Architecture

Backlinks Navigator shows a floating popup **inside the CodeMirror 6 markdown editor** with two
tabs: **Backlinks** (every note that links to the current note) and **Links** (every distinct note
the current note links to). Clicking an entry navigates to that note. It deliberately does **not**
use Joplin's panel/webview API — the UI is a `<div>` mounted into the editor's scroll DOM.

The two directions share one row type, `LinkItem` (`src/types.ts`), distinguished by a `direction`
field (`'in'` = backlink, `'out'` = outgoing link).

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

- `{ type: 'getBacklinks', noteId }` → host returns `LinkItem[]` (backlinks).
- `{ type: 'getOutgoingLinks', noteId }` → host returns `LinkItem[]` (distinct notes the current
  note links to).
- `{ type: 'getIndicatorState', noteId }` → host returns `{ enabled: false }` when the
  "show indicator" setting is off (no search performed), otherwise
  `{ enabled: true, backlinks, outgoing }` (both directions, so the badge can show both counts).
- `{ type: 'openNote', noteId, mode? }` → host opens the note in the current editor, or resolves the
  configured Ctrl-click/Ctrl-Enter behavior to open it in a new window or through Note Tabs, returns `void`.
- `{ type: 'openPanel' }` → host runs the `Show Backlinks` command (so the panel opens with the
  configured dimensions and correct mobile flag), returns `void`.

## Link discovery (host)

Shared, Joplin-free helpers live in `src/linkExtraction.ts` (snippet cleaning, section lookup,
occurrence/offset scanning, and `extractNoteLinks`/`extractOccurrenceContexts`). Note/notebook
metadata resolution (with per-call memoization) lives in `src/noteMetadata.ts`, and the common row
comparator in `src/linkSort.ts`.

**Backlinks** — `src/backlinksService.ts`:

1. Paginate `joplin.data.get(['search'], { query: noteId, fields: [...] })`. A 32-char note
   id is a single FTS token, so this returns candidate linking notes.
2. Verify each candidate's body actually contains `:/<noteId>` (drops loose FTS matches) and
   create one backlink row (`direction: 'in'`) for each matching occurrence, using that
   occurrence's line as the context snippet.
3. Resolve each note's parent notebook title (cached per call).
4. Sort by title, then occurrence order within each note.

**Outgoing links** — `src/outgoingLinksService.ts`: no FTS search needed. Fetch the current note's
body, `extractNoteLinks` finds every `:/<id>` occurrence in document order, group **per distinct
target note** (one row, `direction: 'out'`, `occurrenceCount` = number of links). Each target's
title, parent notebook, and body are resolved in one Data API call (`resolveNoteMeta` with
`includeBody`); the snippet previews the **opening of the linked note** (`extractNoteOpening`, which
skips a leading heading/title and thematic breaks) rather than the context around the link in the
current note, and `section` is always empty (outgoing links have no nearest-heading preview).
Self-links, ignored notes, and broken (unresolvable) links are skipped. Sort by title.

Navigation uses `joplin.commands.execute('openItem', ':/' + noteId)`.

## Panel lifecycle (content script)

- `src/contentScripts/backlinksNavigator.ts` — reads the note id from
  `editorControl.joplinExtensions.noteIdFacet`, registers the `togglePanel` editor command,
  opens the panel in a loading state, always fetches **both** backlinks and outgoing links fresh in
  parallel (`setLinks('in', …)` / `setLinks('out', …)`), and forwards clicks to the host. A monotonic
  request token prevents a slow response from populating a stale/closed panel. When a **backlink** is
  selected it records a "pending scroll" (the target note id, the `:/<currentNoteId>` needle, and
  the selected occurrence index) before navigating; once the target note loads it scrolls to that
  occurrence. **Outgoing** links just open the target note (there's no reference-back to scroll to). The cursor is placed at the start of the
  enclosing markdown link (see `markdownLinkPosition.ts`) rather than inside the URL, and the
  matched reference is briefly highlighted (see `referenceHighlight.ts`). The same `EditorView`
  is reused across note switches on desktop, so this closure state survives navigation; a short
  retry handles the gap before the new content settles, and the scroll is re-asserted once after
  Joplin's own post-load cursor restoration.
- `src/contentScripts/markdownLinkPosition.ts` — given the position of a found `:/<noteId>` URL,
  resolves the range of the enclosing inline markdown link (`[label](:/id)`, including a leading
  `!` for embed syntax) on the same line. Falls back to just the URL range for raw note
  references or when no same-line link encloses the URL. Used to choose the cursor target and the
  highlight range.
- `src/contentScripts/referenceHighlight.ts` — a CodeMirror `StateField`/`StateEffect` pair that
  decorates the matched reference range with a `mark` highlight. The highlight is applied via
  `setReferenceHighlightEffect` and cleared automatically on the next selection change that isn't
  the originating dispatch, so it disappears as soon as the user moves the cursor.
- `src/contentScripts/ui/backlinksPanel.ts` — the floating panel UI: a two-tab strip
  (Backlinks / Links, each with a live count), filter input, fuzzy filtering, keyboard navigation
  (arrows/Tab/Enter/Escape, plus `Ctrl+Tab` to switch tabs), and per-tab loading/empty/error
  states. The active list feeds the shared filter/render machinery. Preview detail is a render-time
  setting, separately configurable for backlinks (`title`, `title + snippet`, or
  `title + snippet + nearest heading`) and outgoing links (`title` or `title + snippet` only — the
  outgoing snippet previews the linked note's opening, which has no enclosing heading to show). The panel owns the **default-tab** policy: after each
  tab resolves, and until the user manually switches, it selects backlinks if any exist, otherwise
  outgoing if any exist, otherwise backlinks — so this rule governs every entry point
  (command/toolbar and indicator alike).
- `src/contentScripts/ui/backlinkIndicator.ts` — an optional clickable badge (icon + per-direction
  counts, `← n` backlinks / `→ n` outgoing, each shown only when non-zero) floated in the editor's
  top-right when the current note has any links. Gated by the "show indicator" setting (default
  off). On note load the entry sends `getIndicatorState` (debounced); when enabled it caches both
  directions purely to drive the badge counts (the panel does not read this cache). The badge hides
  while the panel is open (same corner) and clears on note switch. The panel always fetches fresh
  on open (see below), and those fresh results refresh the badge cache too, so clicking a
  temporarily-stale badge brings both the panel and the badge up to date.
- `src/contentScripts/ui/noteIdWatcher.ts` — a transaction extender that reports note-id
  changes (note switch); the entry uses it to close the panel and trigger the pending scroll.
- `src/contentScripts/theme/panelTheme.ts` — CSS using `var(--joplin-*)` theme variables,
  injected as a single `<style>` element.

## Build

`npm run dist` runs three webpack passes (main, extra scripts, archive). The content script
entry is declared in `plugin.config.json` (`extraScripts`) and registered in
`src/manifest.json` (`content_scripts`). CodeMirror/Lezer modules are treated as externals —
Joplin provides them at runtime.
