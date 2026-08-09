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

- `src/backlinksService.ts` finds notes that mention the current note id, verifies their rendered
  Markdown links, and returns one backlink row per valid link use.
- `src/outgoingLinksService.ts` reads the current note, extracts distinct rendered note-link
  destinations, and returns one outgoing-link row per destination.
- Each service also exposes a counting entry point (`countBacklinks`, `countOutgoingLinks`) that
  shares the discovery work but stops before row enrichment. See [Indicator Counts](#indicator-counts).
- `src/markdownParser.ts` creates one standalone Lezer tree and line index per body. The focused
  `linkExtraction.ts`, `markdownHeadings.ts`, `htmlAnchors.ts`, and `snippetExtraction.ts` helpers
  share that context for links, headings, HTML anchors, sections, and rendered-text previews.
- `src/markdownText.ts` centralizes logical-label extraction, CommonMark unescaping, and the
  consumer-specific visible-text policies used by headings and snippets.
- `src/noteMetadata.ts` resolves note and notebook metadata with per-call caching.
- `src/linkSort.ts` centralizes row ordering.

### Editor Integration

- `src/contentScripts/backlinksNavigator.ts` is the content-script entry point. It reads the current
  note id, opens/closes the popup, fetches link data, forwards navigation requests, and coordinates
  backlink scrolling after note changes.
- `src/contentScripts/pluginSettings.ts` stores editor-side settings in a CodeMirror facet so UI
  behavior can update without rebuilding the editor extension.
- `src/contentScripts/ui/noteIdWatcher.ts` reports note changes inside the reused editor view.
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
- `src/contentScripts/ui/editorOverlay.ts` mounts both floating elements into the editor's scroll
  DOM, keeps them clear of the scrollbar, and injects their stylesheets. The popup and the badge
  are positioned by one implementation rather than two that happen to match.
- `src/contentScripts/theme/panelTheme.ts` injects the popup and indicator CSS using Joplin theme
  variables. Their shared anchoring is one constant, matching `editorOverlay.ts`.

## Message Boundary

Joplin gives the plugin host API access and the content script editor access. The two sides
communicate through `context.postMessage(...)`, which behaves like request/response:

- `getBacklinks` returns backlink rows.
- `getOutgoingLinks` returns outgoing-link rows.
- `getIndicatorState` returns `LinkCounts` for the badge, unless the indicator is disabled.
- `getContentScriptSettings` returns editor-side settings.
- `openNote` opens a target note, using the configured current-window/new-window/Note Tabs behavior.
- `openPanel` runs the host command that opens the popup.

## Link Model

Both tabs use `LinkItem`. The `direction` field distinguishes rows:

- `in` means a backlink from another note to the current note.
- `out` means an outgoing link from the current note to another note.

Backlinks are occurrence-based because the same source note can link to the current note many times.
Inline links and valid full, collapsed, or shortcut reference links each count at the rendered use;
an unused reference definition does not count. Images, raw HTML, bare destinations, code, comments,
undefined references, and malformed note destinations are not links in this model.

Outgoing links are destination-based, where a destination is a target note plus an optional
anchor: `[a](:/id)` and `[b](:/id#some-anchor)` produce separate rows, while repeats of either
collapse into one row. The row's `anchor` holds the fragment (empty for a whole-note row) and
`section` names what it resolves to, which the panel always shows for anchored rows so they can be
told apart from the note's own row.

An anchor resolves in priority order: first against the heading index (`parseMarkdownHeadings` in
`markdownHeadings.ts`), then against the HTML-anchor index (`parseHtmlAnchors` in `htmlAnchors.ts`).

The shared Lezer heading index excludes heading-like text in code blocks, recognizes ATX and Setext
headings, and records each heading's rendered text and source range. Anchor slugs use Joplin's
`fork-uslug` with the plugin's existing global duplicate policy (`intro`, `intro-2`, `intro-3`, …).
The HTML-anchor index scans only Lezer-recognized inline/block HTML regions for explicit `id`/`name`
attributes, e.g. `<a id="in3b65">The MERN stack</a>`; comments and code are excluded by syntax-tree
structure. An element's rendered text becomes the row label and its line is previewed. An anchor
that names neither a heading nor an HTML anchor falls back to the raw slug and note opening.

Snippet extraction walks the same tree with a prose policy: Markdown/HTML markers and link
destinations are omitted, while link labels, image alt text, inline code, escapes, and entities are
rendered as visible text. Code blocks, reference definitions, and thematic breaks do not become
opening previews.

The heading index also bounds anchored-section previews, supplies backlink section labels, and gives
editor navigation the exact source range to highlight; the HTML-anchor index likewise provides the
source range editor navigation highlights for non-heading anchors.

## Indicator Counts

The badge renders two numbers, so the host counts links for it instead of resolving `LinkItem`
rows. `countBacklinks` and `countOutgoingLinks` reuse each service's discovery step and skip the
enrichment: no snippets, no section headings, no notebook titles, and — the expensive part — no body
fetch or target-body parse. Discovery still performs the lightweight Lezer parse needed to
distinguish rendered links from code and examples. Counting outgoing links also costs one body-less
lookup per destination, because a link to a deleted note is broken and the panel drops it; counting
it would put the badge out of step with the list.

`LinkCounts` carries both `backlinkOccurrences` and `backlinkNotes` because the choice between them
is display policy: title-only backlink mode collapses occurrences to one row per source note. That
policy lives in `linkDisplay.ts` and is applied by the content script, which owns the current
preview settings — `getDisplayCounts` for the badge, `getDisplayLinks`/`getDisplayLinkCount` for the
panel list and tab counts, all deriving from one predicate so they cannot disagree.

Opening the panel still fetches full rows for both directions, deliberately: the panel must not show
results that went stale while the note sat open. Those rows also refresh the badge's cached counts
(`toBacklinkCounts`), so clicking the indicator brings it up to date.

## Navigation Model

Both directions can carry a pending scroll, recorded by the content script before navigation and
applied after the next note id change: it places the cursor, scrolls the target into view, and
highlights it briefly.

- Backlinks rerun the shared link extractor and scroll to the exact rendered Markdown-link use in the
  source note. This also highlights reference-style uses instead of their definitions. Title-only
  backlink previews collapse occurrences into one row per source note, so those rows don't scroll.
- Outgoing links to an anchor scroll to the heading that anchor names, or to the explicit HTML
  anchor (`<a id="…">`) it points at. The anchor is also passed to the host, which opens
  `:/<id>#<anchor>` so Joplin's own navigation agrees.
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
- Settings are normalized before they reach editor UI code, in the units the user set them in:
  panel dimensions stay in pixels and percent from the settings screen through to the generated CSS,
  so `panelDimensions.ts` validates each one against a single range.

The result is a small loop: read note id, find links, display rows, open the selected note.
