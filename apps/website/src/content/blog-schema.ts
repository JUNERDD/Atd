import { Type, type Static } from 'typebox';
import type { Localized } from '../i18n/routes.ts';

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
    /** Plain text; a blank line starts a new paragraph. */
    body: Text,
    image: ImagePath,
    /** What the image shows, for readers who cannot see it. */
    alt: Text,
  },
  { additionalProperties: false },
);

/**
 * A fix or a small improvement: one line, and where seeing the change helps, an image with its
 * description. The build requires the two together (`blog-content.ts`).
 */
export const BlogFixSchema = Type.Object(
  {
    text: Text,
    image: Type.Optional(ImagePath),
    alt: Type.Optional(Text),
  },
  { additionalProperties: false },
);

export const BlogPostSchema = Type.Object(
  {
    /** The released version, without a leading `v`; the same in every language. */
    version: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$' }),
    /** The publishing day, `YYYY-MM-DD`; the same in every language. */
    date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    title: Text,
    summary: Text,
    highlights: Type.Array(BlogHighlightSchema),
    fixes: Type.Optional(Type.Array(BlogFixSchema)),
  },
  { additionalProperties: false },
);

export type BlogPostEntry = Static<typeof BlogPostSchema>;

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
  /** The body split into paragraphs. */
  paragraphs: string[];
  image: BlogImage;
  alt: string;
}

/** An image and what it shows. */
export interface BlogFigure {
  image: BlogImage;
  alt: string;
}

export interface BlogFix {
  text: string;
  figure: BlogFigure | null;
}

export interface BlogPostCopy {
  /** The publishing date as the language writes it, formatted once at build time so the
   *  prerendered page and the hydrated one agree whatever the browser's date data. */
  dateLabel: string;
  title: string;
  summary: string;
  highlights: BlogHighlight[];
  fixes: BlogFix[];
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
