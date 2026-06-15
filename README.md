# Backlinks Navigator

A Joplin plugin for viewing and navigating to backlinks in the Markdown editor.

## Features

- Shows notes that link to the current note
- Opens backlinks from a compact floating panel
- Filters backlinks by note title
- Shows notebook, section, and link context when available
- Optionally shows a backlink count indicator in the editor (which can also be used to open the panel)
- Works on desktop and mobile

## Usage

Open the backlinks panel from the editor toolbar, the Edit menu, or the `Show Backlinks` command.

Click a backlink to open the note that links to the current note. On desktop, the editor will try to scroll to the line that contains the link back to the previous note after note switch (I'm not sure if its possible to make this work on mobile).

## Settings

- Panel width
- Panel max height
- Show backlink indicator
- Enable debug logging

## Development

```sh
npm test
npm run lint
npm run format
npm install
npm run dist
```

The built plugin archive is created in `publish/`.
