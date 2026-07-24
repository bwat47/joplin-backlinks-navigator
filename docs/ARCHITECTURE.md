# Backlinks Navigator Architecture

Backlinks Navigator adds a floating popup to Joplin's CodeMirror 6 Markdown editor. The popup has
two tabs: Backlinks for notes that link to the current note, and Outgoing Links for notes the current note
links to. Selecting an entry opens the target note.

The UI is mounted directly in the editor scroll DOM. It does not use Joplin's panel or webview API.

## Request Flow

1. The content script reads the current note id from the editor.
2. The user opens the popup through the command, toolbar button, menu item, or indicator badge.
3. The popup asks the plugin host for backlinks and outgoing links.
4. The host searches or parses note bodies, resolves note metadata, and returns `LinkItem` rows.
5. The content script filters, displays, and keyboard-navigates those rows.
6. Selecting a row asks the host to open the note. Backlink selections also try to scroll to the
   matched reference in the target note.

## Main Pieces

### Plugin Shell

- `src/index.ts` boots the plugin, registers commands, settings, toolbar/menu integration, the
  content script, and the message handler.
- `src/settings.ts` defines user-facing settings.
- `src/messages.ts` defines the request and response shapes shared across the host/content-script
  boundary.
- `src/types.ts` defines shared domain types, including `LinkItem`.

### Link Discovery

- `src/backlinksService.ts` finds notes that contain `:/<currentNoteId>`, verifies each match, and
  returns one backlink row per occurrence.
- `src/outgoingLinksService.ts` reads the current note, extracts distinct `:/<noteId>[#<anchor>]`
  destinations, and returns one outgoing-link row per destination.
- `src/linkExtraction.ts` contains Joplin-free parsing helpers for note links, snippets, sections,
  occurrence offsets, and a shared `markdown-it` heading index.
- `src/noteMetadata.ts` resolves note and notebook metadata with per-call caching.
- `src/linkSort.ts` centralizes row ordering.

### Editor Integration

- `src/contentScripts/backlinksNavigator.ts` is the content-script entry point. It reads the current
  note id, opens/closes the popup, fetches link data, forwards navigation requests, and coordinates
  backlink scrolling after note changes.
- `src/contentScripts/pluginSettings.ts` stores editor-side settings in a CodeMirror facet so UI
  behavior can update without rebuilding the editor extension.
- `src/contentScripts/ui/noteIdWatcher.ts` reports note changes inside the reused editor view.
- `src/contentScripts/markdownLinkPosition.ts` locates the full Markdown link around a matched
  `:/<noteId>` reference.
- `src/contentScripts/referenceHighlight.ts` briefly highlights the matched reference after
  navigation.

### UI

- `src/contentScripts/ui/backlinksPanel.ts` renders the floating two-tab popup, filter input,
  keyboard navigation, loading/empty/error states, and row previews.
- `src/contentScripts/ui/backlinkIndicator.ts` renders the optional editor-corner badge showing
  inbound and outbound counts.
- `src/linkDisplay.ts` contains the shared display policy used by both the popup and the indicator.
  In title-only backlink mode, inbound rows are collapsed to one row per source note.
- `src/contentScripts/ui/fuzzyFilter.ts` handles popup filtering.
- `src/contentScripts/theme/panelTheme.ts` injects the popup and indicator CSS using Joplin theme
  variables.

## Message Boundary

Joplin gives the plugin host API access and the content script editor access. The two sides
communicate through `context.postMessage(...)`, which behaves like request/response:

- `getBacklinks` returns backlink rows.
- `getOutgoingLinks` returns outgoing-link rows.
- `getIndicatorState` returns the counts data needed by the badge, unless the indicator is disabled.
- `getContentScriptSettings` returns editor-side settings.
- `openNote` opens a target note, using the configured current-window/new-window/Note Tabs behavior.
- `openPanel` runs the host command that opens the popup.

## Link Model

Both tabs use `LinkItem`. The `direction` field distinguishes rows:

- `in` means a backlink from another note to the current note.
- `out` means an outgoing link from the current note to another note.

Backlinks are occurrence-based because the same source note can link to the current note many times.

Outgoing links are destination-based, where a destination is a target note plus an optional heading
anchor: `[a](:/id)` and `[b](:/id#some-heading)` produce separate rows, while repeats of either
collapse into one row. The row's `anchor` holds the heading slug (empty for a whole-note row) and
`section` names the heading it resolves to, which the panel always shows for anchored rows so they
can be told apart from the note's own row.

Heading-sensitive behavior uses `parseMarkdownHeadings` in `linkExtraction.ts`. The shared
`markdown-it` index excludes heading-like text in code blocks, recognizes ATX and Setext headings,
and records each heading's rendered text and source range. Anchor slugs use Joplin's `fork-uslug`
with the plugin's existing global duplicate policy (`intro`, `intro-2`, `intro-3`, …). An anchor
that no longer names a heading falls back to displaying the raw slug.

The same index resolves outgoing anchors, bounds anchored-section previews, supplies backlink
section labels, and gives editor navigation the exact source range to highlight.

## Navigation Model

Both directions can carry a pending scroll, recorded by the content script before navigation and
applied after the next note id change: it places the cursor, scrolls the target into view, and
highlights it briefly.

- Backlinks scroll to the matching `:/<currentNoteId>` reference in the source note. Title-only
  backlink previews collapse occurrences into one row per source note, so those rows don't scroll.
- Outgoing links to a heading anchor scroll to that heading. The anchor is also passed to the host,
  which opens `:/<id>#<anchor>` so Joplin's own navigation agrees.
- Outgoing links without an anchor simply open the destination note.

## Build

`npm run dist` runs the webpack build and creates the plugin archive in `publish/*.jpl`.

The content script entry is listed in `plugin.config.json` as an `extraScripts` entry and registered
in `src/manifest.json`. CodeMirror and Lezer packages are externalized because Joplin provides them
at runtime.

## Design Intent

The project keeps a few boundaries clear:

- Joplin API work stays in the plugin host.
- Editor and DOM work stays in the content script.
- Link parsing stays in shared, Joplin-free helpers.
- Display rules stay in one place so the panel and indicator agree.
- Settings are normalized before they reach editor UI code.

The result is a small loop: read note id, find links, display rows, open the selected note.
