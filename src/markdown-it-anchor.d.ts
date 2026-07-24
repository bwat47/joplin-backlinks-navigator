declare module 'markdown-it-anchor' {
    import type { PluginWithOptions } from 'markdown-it';

    interface MarkdownItAnchorOptions {
        slugify?: (value: string) => string;
    }

    const markdownItAnchor: PluginWithOptions<MarkdownItAnchorOptions>;
    export default markdownItAnchor;
}
