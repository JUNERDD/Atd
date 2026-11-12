import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { imageSize } from 'image-size';
import { Value } from 'typebox/value';
import type { Plugin, ResolvedConfig } from 'vite';
import { parse } from 'yaml';
import { parseHighlightBody, parseNoteText } from './blog-markdown.ts';
import {
  BLOG_NOTE_KINDS,
  BlogPostSchema,
  type BlogNote,
  type BlogNoteKind,
  type BlogPost,
  type BlogPostCopy,
  type BlogPostEntry,
} from './src/content/blog-schema.ts';
import { htmlLang, LANGS, type Lang } from './src/i18n/routes.ts';

const virtualId = 'virtual:atd-blog';
const resolvedId = '\0' + virtualId;

/** Where the CMS keeps the posts: one folder per language, one YAML file per post. */
export const blogDir = 'src/content/blog';

function fail(file: string, message: string): never {
  throw new Error(`Blog post ${file}: ${message}`);
}

function readEntry(path: string, file: string): BlogPostEntry {
  let data: unknown;
  try {
    data = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(file, `is not valid YAML (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (Value.Check(BlogPostSchema, data)) return data;
  const issue = [...Value.Errors(BlogPostSchema, data)][0];
  return fail(file, issue ? `${issue.instancePath || '/'} ${issue.message}.` : 'is invalid.');
}

function checkDate(date: string, file: string) {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date)
    fail(file, `has no such date: ${date}.`);
}

/** An anchor from an English title: `Choose your panel background` → `choose-your-panel-background`. */
function anchorOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Reads every post in every language. Each post must exist in all languages under the same file
 * name and agree there on its version, its date and how many highlights it has (the sections take
 * their anchors from the English titles); each image, a highlight's or a fix's, must be a file under
 * `public`, whose intrinsic size the page needs to reserve its box. `watch` receives every file read.
 */
function loadPosts(root: string, publicDir: string, watch: (file: string) => void): BlogPost[] {
  const dir = join(root, blogDir);
  const files = new Map<string, Map<Lang, BlogPostEntry>>();
  for (const lang of LANGS) {
    for (const name of readdirSync(join(dir, lang))) {
      if (!/\.ya?ml$/.test(name)) continue;
      const path = join(dir, lang, name);
      watch(path);
      const entries = files.get(name) ?? new Map<Lang, BlogPostEntry>();
      entries.set(lang, readEntry(path, `${lang}/${name}`));
      files.set(name, entries);
    }
  }
  const image = (src: string, file: string) => {
    const path = join(publicDir, ...src.slice(1).split('/'));
    if (relative(publicDir, path).startsWith('..' + sep))
      fail(file, `image ${src} is outside public.`);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      return fail(file, `image ${src} is missing from public.`);
    }
    watch(path);
    const { width, height } = imageSize(bytes);
    return { src, width, height };
  };
  const slugs = new Set<string>();
  const posts = [...files].map(([name, entries]): BlogPost => {
    const entryOf = (lang: Lang): BlogPostEntry =>
      entries.get(lang) ?? fail(name, `has no ${lang} version.`);
    // English is the source language; every translation must describe the same release.
    const source = entryOf('en');
    for (const entry of LANGS.map(entryOf)) {
      if (entry.version !== source.version || entry.date !== source.date)
        fail(name, 'must have the same version and date in every language.');
      if (entry.highlights.length !== source.highlights.length)
        fail(name, 'must have the same number of highlights in every language.');
      for (const kind of BLOG_NOTE_KINDS) {
        if ((entry[kind]?.length ?? 0) !== (source[kind]?.length ?? 0))
          fail(name, `must have the same number of ${kind} items in every language.`);
      }
    }
    checkDate(source.date, name);
    const slug = `atd-${source.version.replaceAll('.', '-')}`;
    if (slugs.has(slug)) fail(name, `repeats version ${source.version}.`);
    slugs.add(slug);
    const reservedAnchors = new Set<string>(BLOG_NOTE_KINDS);
    const anchors = source.highlights.map((highlight, index) => {
      const anchor = anchorOf(highlight.title);
      if (
        !anchor ||
        reservedAnchors.has(anchor) ||
        source.highlights.slice(0, index).some((other) => anchorOf(other.title) === anchor)
      )
        fail(`en/${name}`, `highlight “${highlight.title}” needs a distinct English title.`);
      return anchor;
    });
    const copy = (lang: Lang): BlogPostCopy => {
      const entry = entryOf(lang);
      const file = `${lang}/${name}`;
      const notes = (kind: BlogNoteKind): BlogNote[] =>
        (entry[kind] ?? []).map((note, index) => {
          const content = parseNoteText(note.text, file, kind, index);
          if (note.image !== undefined && note.alt !== undefined)
            return { content, figure: { image: image(note.image, file), alt: note.alt } };
          if (note.image !== undefined || note.alt !== undefined)
            fail(
              file,
              `${kind} “${note.text}” needs both an image and its description, or neither.`,
            );
          return { content, figure: null };
        });
      return {
        dateLabel: new Intl.DateTimeFormat(htmlLang[lang], {
          dateStyle: 'long',
          timeZone: 'UTC',
        }).format(new Date(`${entry.date}T00:00:00Z`)),
        title: entry.title,
        summary: entry.summary,
        highlights: entry.highlights.map((highlight, index) => ({
          anchor: anchors[index] ?? fail(file, 'has an extra highlight.'),
          title: highlight.title,
          blocks: parseHighlightBody(highlight.body, file, highlight.title),
          image: image(highlight.image, file),
          alt: highlight.alt,
        })),
        improvements: notes('improvements'),
        fixes: notes('fixes'),
        other: notes('other'),
      };
    };
    return {
      slug,
      version: source.version,
      date: source.date,
      copy: { en: copy('en'), zh: copy('zh') },
    };
  });
  // Newest first. Numeric collation compares each part of the validated `x.y.z` as a number.
  return posts.sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
}

/**
 * Serves the CMS's blog to the pages as `virtual:atd-blog`, validated at build time, so the
 * prerendered pages and the client bundle share the same data and the validator stays in Node. On
 * the dev server, adding or removing a post file or image reloads the page; edits to files already
 * read reload through Vite's watch on them.
 */
export function blogContent(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'atd-blog-content',
    configResolved(resolved) {
      config = resolved;
    },
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    configureServer(server) {
      const watched = [join(config.root, blogDir), join(config.publicDir, 'media')];
      const refresh = (file: string) => {
        if (!watched.some((dir) => file.startsWith(dir + sep))) return;
        const module = server.moduleGraph.getModuleById(resolvedId);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
    load(id) {
      if (id !== resolvedId) return;
      const posts = loadPosts(config.root, config.publicDir, (file) => this.addWatchFile(file));
      return `export default ${JSON.stringify(posts)};`;
    },
  };
}
