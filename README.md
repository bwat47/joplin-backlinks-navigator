# Backlinks Navigator

A Joplin plugin for viewing and navigating to backlinks in the Markdown editor.

## Features

- Shows notes that link to the current note
- Shows each link occurrence when a note links more than once
- Opens backlinks from a compact floating panel
- Filters backlinks by note title
- Shows notebook, section, and link context when available
- Optionally shows a backlink count indicator in the editor (which can also be used to open the panel)
- Works on desktop and mobile

## Usage

Open the backlinks panel from the editor toolbar, the Edit menu, or the `Show Backlinks` command.

Click a backlink to open the note that links to the current note. On desktop, the editor will try to scroll to the line that contains the link back to the previous note after note switch.

## Settings

- Panel width
- Panel max height
- Show backlink indicator - recommend using with a max editor width set in joplin settings | editor tab to avoid overlapping content
- Ctrl-click backlink behavior - open in a new window or in a Note Tabs tab (requires the Note Tabs plugin)
- Enable debug logging

## Limitations

- Scrolling to backlink occurrance after note switch only works on desktop (and does not work when opening the note in new window or pinning with note tabs).

## Development

```sh
npm test
npm run lint
npm run format
npm install
npm run dist
```

The built plugin archive is created in `publish/`.
