/**
 * Resolves the editor position to use when focusing a found note-link URL.
 *
 * For standard inline links such as `[Target](:/note-id)`, CodeMirror should
 * place the cursor before the visible markdown link rather than inside the URL.
 * If the URL is not inside a same-line markdown link, the URL position is kept.
 */
export function findMarkdownLinkStart(text: string, urlPosition: number): number {
    if (urlPosition < 0 || urlPosition >= text.length) {
        return urlPosition;
    }

    const lineStart = text.lastIndexOf('\n', urlPosition - 1) + 1;
    const nextNewline = text.indexOf('\n', urlPosition);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;
    const linkUrlStart = text.lastIndexOf('](', urlPosition);

    if (linkUrlStart < lineStart) {
        return urlPosition;
    }

    const labelStart = text.lastIndexOf('[', linkUrlStart);
    const linkEnd = text.indexOf(')', urlPosition);

    if (labelStart < lineStart || linkEnd === -1 || linkEnd > lineEnd) {
        return urlPosition;
    }

    return labelStart;
}
