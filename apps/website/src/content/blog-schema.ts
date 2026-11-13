import { Type, type Static } from 'typebox';
import type { Localized } from '../i18n/routes.ts';
import { BLOG_NOTE_KINDS, type BlogNoteKind } from '../pages/blog/copy.ts';

export { BLOG_NOTE_KINDS, type BlogNoteKind };

/**
 * One language's file of a blog post, as the CMS writes it (`admin/config.yml`):
 * `src/content/blog/<lang>/<file>.yml`. Every post announces a release. The build validates every
 * file against this schema (`blog-content.ts`); the pages only import the types below, so the
 * validator never ships to the browser.
 */
const Text = Type.String({ minLength: 1 });

/** A public path, such as `/media/blog/0.10.6/panel-background.en.webp`. */
const ImagePath = Type.String({ pattern: '^/(?:[\\w.-]+/)*[\\w.-]+\\.(?:avif|webp|png|jpe?g)$' });

export const BlogHighlightSchema = Type.Object(
  {
    title: Text,
    /** Constrained Markdown: paragraphs and flat lists with inline bold, italic, code and links. */
    body: Text,
    image: ImagePath,
    /** What the image shows, for readers who cannot see it. */
    alt: Text,
  },
  { additionalProperties: false },
);

/**
 * One item in a post's tail sections (`improvements`, `fixes`, or `other`): one inline Markdown
 * paragraph, and where seeing the change helps, an image with its description (`blog-content.ts`).
 */
export const BlogNoteSchema = Type.Object(
  {
    text: Text,
    image: Type.Optional(ImagePath),
    alt: Type.Optional(Text),
  },
  { additionalProperties: false },
);

export const BlogFixSchema = BlogNoteSchema;

export const BlogPostSchema = Type.Object(
  {
    /** The released version, without a leading `v`; the same in every language. */
    version: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$' }),
    /** The publishing day, `YYYY-MM-DD`; the same in every language. */
    date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    title: Text,
    summary: Text,
    highlights: Type.Array(BlogHighlightSchema),
    improvements: Type.Optional(Type.Array(BlogNoteSchema)),
    fixes: Type.Optional(Type.Array(BlogNoteSchema)),
    other: Type.Optional(Type.Array(BlogNoteSchema)),
  },
  { additionalProperties: false },
);

export type BlogPostEntry = Static<typeof BlogPostSchema>;

/** Inline editorial formatting parsed at build time (`blog-markdown.ts`). */
export type BlogInline =
  | string
  | { kind: 'strong'; children: BlogInline[] }
  | { kind: 'em'; children: BlogInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: BlogInline[] };

/** Block structure allowed inside a highlight's body. */
export type BlogBlock =
  | { kind: 'paragraph'; children: BlogInline[] }
  | { kind: 'list'; ordered: boolean; items: BlogInline[][] };

/** A post's image, with the intrinsic size the build reads so the page reserves its box. */
export interface BlogImage {
  src: string;
  width: number;
  height: number;
}

export interface BlogHighlight {
  /** The section's anchor, from the English title, so both languages link to the same one. */
  anchor: string;
  title: string;
  /** The body parsed into validated paragraphs and lists. */
  blocks: BlogBlock[];
  image: BlogImage;
  alt: string;
}

/** An image and what it shows. */
export interface BlogFigure {
  image: BlogImage;
  alt: string;
}

export interface BlogNote {
  content: BlogInline[];
  figure: BlogFigure | null;
}

export type BlogFix = BlogNote;

export interface BlogPostCopy {
  /** The publishing date as the language writes it, formatted once at build time so the
   *  prerendered page and the hydrated one agree whatever the browser's date data. */
  dateLabel: string;
  title: string;
  summary: string;
  highlights: BlogHighlight[];
  improvements: BlogNote[];
  fixes: BlogNote[];
  other: BlogNote[];
}

/** One post in both languages, as the pages render it (`virtual:atd-blog`). */
export interface BlogPost {
  /** The URL segment under `/blog/`: `atd-0-10-6` for 0.10.6, dot-free so no host takes it for a
   *  file name. */
  slug: string;
  version: string;
  date: string;
  copy: Localized<BlogPostCopy>;
}
