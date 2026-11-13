import { Marked, type Token, type Tokens } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import type { BlogBlock, BlogInline, BlogNoteKind } from './src/content/blog-schema.ts';

/**
 * Build-time parser for the blog's constrained editorial Markdown subset.
 *
 * `marked` runs only in Node during Vite's `virtual:atd-blog` load (`blog-content.ts`): the client
 * receives small serializable `BlogBlock` / `BlogInline` trees and renders React elements directly,
 * with zero parser runtime in the browser and no `dangerouslySetInnerHTML`.
 *
 * `marked-cjk-friendly` fixes CommonMark flanking delimiter rules when `**bold**` or `*italic*`
 * sits next to Chinese quotation marks or parentheses without surrounding spaces.
 */
const markdown = new Marked(markedCjkFriendly(), { gfm: true, breaks: false });

function fail(file: string, context: string, message: string): never {
  throw new Error(`Blog post ${file} (${context}): ${message}`);
}

function isAllowedHref(href: string): boolean {
  if (/^https?:\/\/\S+$/i.test(href)) return true;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  if (href.startsWith('#') && href.length > 1) return true;
  return false;
}

function tokenText(token: Token, file: string, context: string): string {
  if ('text' in token && typeof token.text === 'string') return token.text;
  return fail(file, context, `expected text on Markdown token “${token.type}”.`);
}

function mergeText(nodes: BlogInline[]): BlogInline[] {
  const merged: BlogInline[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (typeof node === 'string' && typeof previous === 'string') {
      merged[merged.length - 1] = previous + node;
    } else if (node !== '') {
      merged.push(node);
    }
  }
  return merged;
}

function parseInlines(
  tokens: Token[] | undefined,
  file: string,
  context: string,
  insideLink = false,
): BlogInline[] {
  if (!tokens || tokens.length === 0) return fail(file, context, 'has empty inline content.');
  const out: BlogInline[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        if (token.tokens && token.tokens.length > 0) {
          out.push(...parseInlines(token.tokens, file, context, insideLink));
        } else {
          out.push(tokenText(token, file, context));
        }
        break;
      case 'escape':
        out.push(tokenText(token, file, context));
        break;
      case 'strong':
        out.push({
          kind: 'strong',
          children: parseInlines(token.tokens, file, context, insideLink),
        });
        break;
      case 'em':
        out.push({
          kind: 'em',
          children: parseInlines(token.tokens, file, context, insideLink),
        });
        break;
      case 'codespan': {
        const text = tokenText(token, file, context);
        if (text.length === 0) return fail(file, context, 'has an empty code span.');
        out.push({ kind: 'code', text });
        break;
      }
      case 'link': {
        if (insideLink) return fail(file, context, 'cannot nest a link inside another link.');
        const rawHref = 'href' in token && typeof token.href === 'string' ? token.href : '';
        const href = rawHref.trim();
        if (!isAllowedHref(href)) {
          return fail(
            file,
            context,
            `has disallowed link URL “${rawHref}” (use https://, http://, /, or #).`,
          );
        }
        out.push({
          kind: 'link',
          href,
          children: parseInlines(token.tokens, file, context, true),
        });
        break;
      }
      default:
        return fail(file, context, `uses unsupported inline Markdown token “${token.type}”.`);
    }
  }
  const merged = mergeText(out);
  if (merged.length === 0) return fail(file, context, 'has empty inline content.');
  return merged;
}

function parseListItem(item: Tokens.ListItem, file: string, context: string): BlogInline[] {
  if (item.task) return fail(file, context, 'task list checkboxes are not supported.');
  const blocks = item.tokens.filter((token) => token.type !== 'space');
  if (blocks.some((token) => token.type === 'list')) {
    return fail(file, context, 'nested sublists are not supported.');
  }
  if (blocks.length !== 1) {
    return fail(file, context, 'each list item must be a single paragraph.');
  }
  const [only] = blocks;
  if (!only || (only.type !== 'paragraph' && only.type !== 'text')) {
    return fail(
      file,
      context,
      `list item uses unsupported Markdown block token “${only?.type ?? 'empty'}”.`,
    );
  }
  return parseInlines(only.tokens ?? [only], file, context);
}

function isListToken(token: Token): token is Tokens.List {
  return token.type === 'list' && 'items' in token && Array.isArray(token.items);
}

/** Parses a highlight's `body` into paragraphs and flat lists. */
export function parseHighlightBody(body: string, file: string, title: string): BlogBlock[] {
  const context = `highlight “${title}”`;
  const tokens = markdown.lexer(body);
  const blocks: BlogBlock[] = [];
  for (const token of tokens) {
    if (token.type === 'space') continue;
    if (token.type === 'paragraph') {
      blocks.push({
        kind: 'paragraph',
        children: parseInlines(token.tokens, file, context),
      });
      continue;
    }
    if (isListToken(token)) {
      if (token.items.length === 0) return fail(file, context, 'has an empty list.');
      blocks.push({
        kind: 'list',
        ordered: Boolean(token.ordered),
        items: token.items.map((item) => parseListItem(item, file, context)),
      });
      continue;
    }
    return fail(file, context, `uses unsupported Markdown block token “${token.type}”.`);
  }
  if (blocks.length === 0) return fail(file, context, 'cannot have an empty body.');
  return blocks;
}

/** Parses a tail note's `text` (`improvements`, `fixes`, or `other`) as a single inline-only paragraph. */
export function parseNoteText(
  text: string,
  file: string,
  kind: BlogNoteKind,
  index: number,
): BlogInline[] {
  const context = `${kind} #${index + 1}`;
  const blocks = markdown.lexer(text).filter((token) => token.type !== 'space');
  if (blocks.length === 0) return fail(file, context, 'cannot have empty text.');
  if (blocks.length > 1) {
    return fail(file, context, 'must be a single inline paragraph without lists or extra blocks.');
  }
  const [only] = blocks;
  if (!only || only.type !== 'paragraph') {
    return fail(
      file,
      context,
      `uses unsupported Markdown block token “${only?.type ?? 'empty'}” (notes allow inline formatting only).`,
    );
  }
  return parseInlines(only.tokens, file, context);
}

/** Parses a fix's `text` as a single inline-only paragraph. */
export function parseFixText(text: string, file: string, index: number): BlogInline[] {
  return parseNoteText(text, file, 'fixes', index);
}
