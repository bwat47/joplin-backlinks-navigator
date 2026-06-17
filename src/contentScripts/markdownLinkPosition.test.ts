import { findMarkdownLinkStart } from './markdownLinkPosition';

const NOTE_ID = '0123456789abcdef0123456789abcdef';

describe('findMarkdownLinkStart', () => {
    it('returns the start of an inline markdown link containing the note URL', () => {
        const text = `A long wrapped sentence before [Target](:/${NOTE_ID}) after`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkStart(text, urlPosition)).toBe(text.indexOf('[Target]'));
    });

    it('uses the matching link when multiple links appear on the same line', () => {
        const text = `[Other](:/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) then [Target](:/${NOTE_ID}#heading)`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkStart(text, urlPosition)).toBe(text.indexOf('[Target]'));
    });

    it('falls back to the URL position for raw note links', () => {
        const text = `Raw reference :/${NOTE_ID}`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkStart(text, urlPosition)).toBe(urlPosition);
    });

    it('does not match markdown link delimiters across lines', () => {
        const text = `[Target](\n:/${NOTE_ID})`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkStart(text, urlPosition)).toBe(urlPosition);
    });
});
