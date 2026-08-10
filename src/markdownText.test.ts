import { parseMarkdownBody } from './markdownParser';
import { referenceDefinitions, unescapeMarkdownText } from './markdownText';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('referenceDefinitions', () => {
    it('indexes normalized labels to unescaped destinations, first definition winning', () => {
        const parsed = parseMarkdownBody(
            `[Use][  MiXeD   Label ]\n\n[mixed label]: <:/${ID}>\n[MIXED LABEL]: /second\n[other]: /third`
        );

        expect([...referenceDefinitions(parsed)]).toEqual([
            ['MIXED LABEL', `:/${ID}`],
            ['OTHER', '/third'],
        ]);
    });

    it('builds the index once per parsed body', () => {
        const parsed = parseMarkdownBody(`[Use][target]\n\n[target]: :/${ID}`);

        expect(referenceDefinitions(parsed)).toBe(referenceDefinitions(parsed));
    });
});

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
