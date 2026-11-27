# Demo notebook

`Backlinks Navigator Demo/` contains 36 fictional notes about work projects, practical knowledge, and everyday plans. The notes use ordinary Markdown links and relative paths, so they can be read in the repository and imported into Joplin without hard-coded note IDs or an API token.

## Import into a test profile

1. In Joplin Desktop, create or switch to a separate test profile using **File → Switch profile**.
2. Install Backlinks Navigator in that profile and restart Joplin if requested.
3. Choose **File → Import → MD - Markdown (directory)** and select **`demo/Backlinks Navigator Demo`**. Import the entire directory in one operation so all cross-notebook links can be resolved. Do not select the enclosing `demo` directory; this guide is kept outside the imported notes.
4. Use the Markdown editor or split view and open **Home** to browse, or **Work → Community workshop** for a busy example. Open the plugin with the toolbar button or **Show Links** command.

Joplin creates notebooks from the directory hierarchy and converts relative Markdown links into internal note links, retaining anchor fragments. This is handled by Joplin's [Markdown importer](https://github.com/laurent22/joplin/blob/dev/packages/lib/services/interop/InteropService_Importer_Md.ts). The source files remain ordinary Markdown; the plugin's link discovery works on the imported internal links.

The data is intentionally small enough to understand by hand. It is a feature demo, rather than a large-vault performance benchmark. Import it once per clean test profile; importing it again creates another copy.

## Suggested checks

Start with details expanded and no ignored notes or notebooks. Counts below refer to distinct linked notes, as shown in the tabs and optional indicator. Repeated occurrences and different anchors create detail rows without increasing those counts.

| Open note                 | Try                                                                                  | Expected behavior                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work / Community workshop | Explore both tabs; filter for `budget` or `venue`.                                   | Backlinks span several notebooks; outgoing links include whole notes, headings, and an HTML anchor. Filtering narrows the list by note title.                                                                                                  |
| Work / Community workshop | Expand **Launch checklist** in outgoing links.                                       | Three destinations: the whole note, **Supplies**, and **Room setup**. The whole-note destination is represented by the group header. The second supplies link does not create another outgoing row.                                            |
| Work / Community workshop | Find **Launch checklist** in backlinks.                                              | Three occurrences under one source note: one under **Before Friday** and two under **Final check**. Clicking each occurrence navigates to its source location on desktop. Enable **Show nearest heading for backlinks** to see section labels. |
| Work / Launch checklist   | Find **Community workshop** in backlinks.                                            | Four occurrences, including both links to **Supplies**. The outgoing tab in the source note collapses those two supplies links into one destination.                                                                                           |
| Knowledge / Link examples | Inspect outgoing details.                                                            | Three linked notes: **Launch checklist**, **Venue notes**, and **Seed starting**. Checklist has four destinations, including the deliberately unresolved `delivery-window` fragment.                                                           |
| Knowledge / Link examples | Open **Backup contact** and **Light & water**.                                       | The first goes to an explicit HTML anchor in Venue notes; the second goes to a Markdown heading in Seed starting.                                                                                                                              |
| Knowledge / Link examples | Open `delivery-window`.                                                              | The target note opens; the plugin falls back to the raw fragment label and note-opening preview because that section does not exist.                                                                                                           |
| Knowledge / Link examples | Compare the web link, local heading jump, and fenced example with the outgoing list. | These do not add linked notes. The fenced example is literal Markdown, not a rendered note link.                                                                                                                                               |
| Personal / Weekly review  | Compare the two **Review** entries.                                                  | One is in Work and one in Personal; notebook labels distinguish the identical titles.                                                                                                                                                          |
| Personal / Quiet morning  | Open both tabs.                                                                      | No backlinks and no outgoing links.                                                                                                                                                                                                            |
| Inbox / Things to revisit | Open both tabs.                                                                      | No backlinks and four outgoing linked notes.                                                                                                                                                                                                   |
| Knowledge / Coffee notes  | Open both tabs.                                                                      | One backlink, from **Things to revisit**, and no outgoing links.                                                                                                                                                                               |
| Work / Community workshop | Toggle compact/detailed view, then close and reopen the popup.                       | Compact view shows one row per linked note; counts stay the same, and the chosen view is remembered. Detailed rows provide context and destination navigation.                                                                                 |

Use arrow keys and Enter in the popup to check keyboard navigation. With the optional indicator enabled, compare its counts to the tabs. To exercise alternate navigation, configure Ctrl-click, Ctrl-Enter, or middle-click in plugin settings and use that gesture on a result. Note Tabs behavior requires the separate Note Tabs plugin. Source-occurrence scrolling and highlighting require current-window desktop navigation.

### Ignore a notebook and its descendants

Open **Community workshop**, then right-click **Archive** and choose **Toggle Backlinks Navigator ignore**. Reopen the popup: **Spring retrospective**, **Previous workshop**, **Old budget**, and **Old supplies** should disappear from backlinks, including the two notes inside **Archive / Planning**. **Previous workshop** should also disappear from outgoing links. Toggle Archive again to restore them.

To check an individual exclusion, copy a note's Markdown link from Joplin, take the 32-character ID after `:/`, and add it to **Ignored note IDs** in plugin settings. Reopen the popup and check that note disappears from results and counts. Clear the setting afterward.

### Reference-style links

Joplin's current [URL replacement helper](https://github.com/laurent22/joplin/blob/dev/packages/lib/markdownUtils.ts) rewrites inline Markdown destinations, but does not rewrite reference definitions. These examples therefore need one manual setup after import rather than shipping relative reference links that would remain unresolved.

In Joplin, copy the Markdown link to **Community workshop**. In **Knowledge / Link examples**, append the following, replacing `NOTE_ID` with the copied link's actual ID:

```markdown
## Reference-style practice

Check the [event plan][workshop-plan] before Friday.
Print the [workshop-plan][] for the welcome desk.
Keep [workshop-plan] nearby during setup.

[workshop-plan]: :/NOTE_ID
```

After the edit has saved, reopen the panel. **Link examples** should have four outgoing linked notes, with the three reference uses sharing one whole-note destination. **Community workshop** should gain one backlink group from Link examples with three occurrences. The definition itself is not an occurrence.

For a stronger parser check, paste a real internal note link into a fenced code block or inline code in **Link examples**. It should create no additional link occurrence. An unused reference definition should also create no occurrence.

### Missing and trashed targets

These states require changes inside Joplin because a plain Markdown directory has no trash metadata:

1. Create a temporary note, copy its Markdown link, and paste that link into **Link examples**. Confirm it appears in outgoing links.
2. Move the temporary note to Trash. It should remain an outgoing result with **Trash** as its notebook label.
3. Permanently delete that temporary note from Trash and reopen the popup. Its broken link should no longer produce an outgoing result or contribute to the count.

This guide describes expected results. Import and editor behavior should still be checked in the Joplin version used for testing.
