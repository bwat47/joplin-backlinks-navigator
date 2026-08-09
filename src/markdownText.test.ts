import { unescapeMarkdownText } from './markdownText';

describe('unescapeMarkdownText', () => {
    it('decodes CommonMark escapes and strict HTML5 entities', () => {
        expect(unescapeMarkdownText('one\\*two &amp; &#x65E5;&#26412;')).toBe('one*two & 日本');
    });

    it('preserves unknown, unterminated, and invalid numeric entities', () => {
        expect(unescapeMarkdownText('&unknown; &amp &#0; &#xD800; &#x80;')).toBe('&unknown; &amp &#0; &#xD800; &#x80;');
    });

    it('only removes backslashes before escapable ASCII punctuation', () => {
        expect(unescapeMarkdownText('\\) \\a \\\\')).toBe(') \\a \\');
    });
});
