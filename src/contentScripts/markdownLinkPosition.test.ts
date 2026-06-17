import { findMarkdownLinkRange } from './markdownLinkPosition';

const NOTE_ID = '0123456789abcdef0123456789abcdef';
const URL_LENGTH = NOTE_ID.length + 2;

describe('findMarkdownLinkRange', () => {
    it('returns the whole markdown link range for inline links', () => {
        const text = `A long wrapped sentence before [Target](:/${NOTE_ID}) after`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkRange(text, urlPosition, URL_LENGTH)).toEqual({
            from: text.indexOf('[Target]'),
            to: text.indexOf(') after') + 1,
        });
    });

    it('uses the matching link when multiple links appear on the same line', () => {
        const text = `[Other](:/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) then [Target](:/${NOTE_ID}#heading)`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkRange(text, urlPosition, URL_LENGTH).from).toBe(text.indexOf('[Target]'));
    });

    it('returns just the URL range for raw note links', () => {
        const text = `Raw reference :/${NOTE_ID}`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkRange(text, urlPosition, URL_LENGTH)).toEqual({
            from: urlPosition,
            to: urlPosition + URL_LENGTH,
        });
    });

    it('returns the URL range for a raw link wedged between markdown links on the same line', () => {
        const text = `[Other](:/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) raw :/${NOTE_ID} then [More](:/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkRange(text, urlPosition, URL_LENGTH)).toEqual({
            from: urlPosition,
            to: urlPosition + URL_LENGTH,
        });
    });

    it('does not match markdown link delimiters across lines', () => {
        const text = `[Target](\n:/${NOTE_ID})`;
        const urlPosition = text.indexOf(`:/${NOTE_ID}`);

        expect(findMarkdownLinkRange(text, urlPosition, URL_LENGTH)).toEqual({
            from: urlPosition,
            to: urlPosition + URL_LENGTH,
        });
    });
});
