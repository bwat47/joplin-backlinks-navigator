/**
 * Resolves the editor position to use when focusing a found note-link URL.
 *
 * For standard inline links such as `[Target](:/note-id)`, CodeMirror should
 * place the cursor before the visible markdown link rather than inside the URL.
 * If the URL is not inside a same-line markdown link, the URL position is kept.
 */
export interface MarkdownLinkRange {
    from: number;
    to: number;
}

export function findMarkdownLinkRange(text: string, urlPosition: number, urlLength: number): MarkdownLinkRange {
    if (urlPosition < 0 || urlPosition >= text.length) {
        return { from: urlPosition, to: urlPosition };
    }

    const lineStart = text.lastIndexOf('\n', urlPosition - 1) + 1;
    const nextNewline = text.indexOf('\n', urlPosition);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;
    const linkUrlStart = text.lastIndexOf('](', urlPosition);

    // The URL must start immediately after `](`; otherwise the `](` belongs to a
    // different markdown link on the same line and this is a raw note reference.
    if (linkUrlStart < lineStart || linkUrlStart + 2 !== urlPosition) {
        return { from: urlPosition, to: urlPosition + urlLength };
    }

    const labelStart = text.lastIndexOf('[', linkUrlStart);
    const linkEnd = text.indexOf(')', urlPosition);

    if (labelStart < lineStart || linkEnd === -1 || linkEnd > lineEnd) {
        return { from: urlPosition, to: urlPosition + urlLength };
    }

    // Include a leading `!` so embed/transclusion syntax (`![label](:/id)`) is
    // treated as part of the link. Joplin has no note transclusion today, but
    // this keeps the range correct if it (or a plugin) ever adds it.
    const from = labelStart > lineStart && text[labelStart - 1] === '!' ? labelStart - 1 : labelStart;

    return { from, to: linkEnd + 1 };
}
