/** The part of `@joplin/turndown-plugin-gfm` 1.0.68 the loader uses; the package ships no types. */
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  /** GFM pipe tables; a table holding lists, headings or code stays HTML. */
  export const tables: TurndownService.Plugin;
}
