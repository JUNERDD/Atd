import { Lexer, type Token, type Tokens } from 'marked';
import type { RichBlock, RichInline, RichListItem } from './tree.ts';

/**
 * Turns a reply's Markdown into the tree the surfaces render (`tree.ts`). Only the service worker
 * imports this: the content script runs on every page and carries no parser. `marked`'s lexer
 * (GFM) reads the text; its HTML renderer is never used. The reply is the agent's output, so it is
 * untrusted: raw HTML stays text as written, an image becomes its alt text (a page never loads
 * anything for it), a link keeps only an http:, https: or mailto: destination, and nesting and
 * size are bounded so no reply can build an unbounded DOM.
 */

/** Formatting nested deeper than this (blocks and text together) shows as its plain text. */
const MAX_DEPTH = 10;
/** Past this many nodes, the rest of a reply shows as its Markdown, unformatted. */
const MAX_NODES = 4000;
/** Replies parsed lately: a reply is pushed to every surface on every change of state. */
const MEMO_SIZE = 4;
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
/** The entities replies use; anything else stays as written. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const memo = new Map<string, RichBlock[]>();

/** The tree for `text`, from the last few replies parsed when it is one of them. */
export function parseReply(text: string): RichBlock[] {
  const known = memo.get(text);
  if (known) {
    memo.delete(text);
    memo.set(text, known);
    return known;
  }
  const blocks = new TreeBuilder().blocks(Lexer.lex(text, { gfm: true }), 0);
  memo.set(text, blocks);
  const oldest = memo.keys().next();
  if (memo.size > MEMO_SIZE && !oldest.done) memo.delete(oldest.value);
  return blocks;
}

/** One reply's tree, counting its nodes against `MAX_NODES`. */
class TreeBuilder {
  private left = MAX_NODES;

  blocks(tokens: readonly Token[], depth: number): RichBlock[] {
    const out: RichBlock[] = [];
    for (const [index, token] of tokens.entries()) {
      if (this.left <= 0) {
        out.push(...this.plainBlock(rawOf(tokens.slice(index))));
        break;
      }
      const block = depth > MAX_DEPTH ? this.plainBlock(token.raw) : this.block(token, depth);
      out.push(...block);
    }
    return out;
  }

  private block(token: Token, depth: number): RichBlock[] {
    switch (token.type) {
      case 'space':
      case 'def':
      case 'checkbox':
        return [];
      case 'paragraph':
      case 'text': {
        const children = this.inlines(token.tokens ?? [token], depth);
        return children.length > 0 ? [this.node({ type: 'paragraph', children })] : [];
      }
      case 'heading': {
        const level = HEADING_LEVELS[Math.min(Math.max(headingDepth(token), 1), 6) - 1] ?? 1;
        const children = this.inlines(token.tokens ?? [], depth + 1);
        return [this.node({ type: 'heading', level, children })];
      }
      case 'code':
        return [this.node({ type: 'codeBlock', lang: langOf(token), text: textOf(token) })];
      case 'blockquote':
        return [this.node({ type: 'quote', children: this.blocks(token.tokens ?? [], depth + 1) })];
      case 'hr':
        return [this.node({ type: 'rule' })];
      case 'list':
        return isList(token) ? this.list(token, depth) : this.plainBlock(token.raw);
      case 'table':
        return isTable(token) ? this.table(token, depth) : this.plainBlock(token.raw);
      default:
        // Raw HTML, and any token this version does not know: the text as the agent wrote it.
        return this.plainBlock(token.raw);
    }
  }

  /** A list; items past the node budget follow it as their Markdown. */
  private list(token: Tokens.List, depth: number): RichBlock[] {
    const start = typeof token.start === 'number' ? token.start : 1;
    const items: RichListItem[] = [];
    for (const [index, item] of token.items.entries()) {
      if (this.left <= 0) {
        const list = this.node({ type: 'list', ordered: token.ordered, start, items });
        return [list, ...this.plainBlock(rawOf(token.items.slice(index)))];
      }
      this.left -= 1;
      const checked = item.task ? item.checked === true : null;
      items.push({ checked, children: this.blocks(item.tokens, depth + 1) });
    }
    return [this.node({ type: 'list', ordered: token.ordered, start, items })];
  }

  /** A table; rows past the node budget follow it as their text. */
  private table(token: Tokens.Table, depth: number): RichBlock[] {
    const cells = (row: readonly Tokens.TableCell[]) =>
      row.map((cell) => {
        this.left -= 1;
        return this.inlines(cell.tokens, depth + 1);
      });
    const align = token.align.map((each) => each ?? null);
    const head = cells(token.header);
    const rows: RichInline[][][] = [];
    for (const [index, row] of token.rows.entries()) {
      if (this.left <= 0) {
        const rest = token.rows.slice(index).map((each) => each.map((cell) => cell.text));
        return [
          this.node({ type: 'table', align, head, rows }),
          ...this.plainBlock(rest.map((each) => `| ${each.join(' | ')} |`).join('\n')),
        ];
      }
      rows.push(cells(row));
    }
    return [this.node({ type: 'table', align, head, rows })];
  }

  private inlines(tokens: readonly Token[], depth: number): RichInline[] {
    const out: RichInline[] = [];
    for (const [index, token] of tokens.entries()) {
      if (this.left <= 0) {
        this.text(out, rawOf(tokens.slice(index)));
        break;
      }
      if (depth > MAX_DEPTH) this.text(out, plain([token]));
      else this.inline(token, depth, out);
    }
    return out;
  }

  private inline(token: Token, depth: number, out: RichInline[]): void {
    switch (token.type) {
      case 'text':
        if (token.tokens && token.tokens.length > 0) {
          for (const child of token.tokens) this.inline(child, depth, out);
        } else this.text(out, decodeEntities(textOf(token)));
        return;
      case 'escape':
        return this.text(out, textOf(token));
      case 'strong':
      case 'em':
      case 'del': {
        const children = this.inlines(token.tokens ?? [], depth + 1);
        out.push(this.node({ type: token.type, children }));
        return;
      }
      case 'codespan':
        out.push(this.node({ type: 'code', text: textOf(token) }));
        return;
      case 'br':
        out.push(this.node({ type: 'br' }));
        return;
      case 'link': {
        const children = this.inlines(token.tokens ?? [], depth + 1);
        const href = safeHref(hrefOf(token));
        // A link anywhere else is only its text, as the agent wrote it.
        if (href !== null) out.push(this.node({ type: 'link', href, children }));
        else for (const child of children) this.append(out, child);
        return;
      }
      case 'image':
        return this.text(out, plain(token.tokens ?? []) || textOf(token));
      case 'checkbox':
        return;
      default:
        // Inline HTML (`<b>`, `<img onerror>`): shown as typed, never as markup.
        return this.text(out, token.raw);
    }
  }

  private plainBlock(raw: string): RichBlock[] {
    const text = raw.trim();
    if (text === '') return [];
    return [this.node({ type: 'paragraph', children: [{ type: 'text', text }] })];
  }

  /** A run of text; adjacent runs become one. */
  private text(out: RichInline[], text: string): void {
    if (text !== '') this.append(out, { type: 'text', text });
  }

  private append(out: RichInline[], node: RichInline): void {
    const last = out.at(-1);
    if (node.type === 'text' && last?.type === 'text') last.text += node.text;
    else out.push(this.node(node));
  }

  private node<T extends RichBlock | RichInline>(node: T): T {
    this.left -= 1;
    return node;
  }
}

function isList(token: Token): token is Tokens.List {
  return token.type === 'list' && 'items' in token && Array.isArray(token.items);
}

function isTable(token: Token): token is Tokens.Table {
  return (
    token.type === 'table' &&
    'header' in token &&
    Array.isArray(token.header) &&
    'rows' in token &&
    Array.isArray(token.rows) &&
    'align' in token &&
    Array.isArray(token.align)
  );
}

function headingDepth(token: Token): number {
  return 'depth' in token && typeof token.depth === 'number' ? token.depth : 1;
}

function textOf(token: Token): string {
  return 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
}

function langOf(token: Token): string {
  return 'lang' in token && typeof token.lang === 'string' ? token.lang.trim() : '';
}

function hrefOf(token: Token): string {
  return 'href' in token && typeof token.href === 'string' ? token.href : '';
}

/** The destination when it is absolute and http:, https: or mailto:, else null. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  return LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
}

/** The text of inline tokens without their formatting (an image's alt text). */
function plain(tokens: readonly Token[]): string {
  return tokens
    .map((token) =>
      'tokens' in token && token.tokens && token.tokens.length > 0
        ? plain(token.tokens)
        : textOf(token),
    )
    .join('');
}

function rawOf(tokens: readonly { raw: string }[]): string {
  return tokens.map((token) => token.raw).join('');
}

/** Numeric character references and the common named ones; marked leaves them in text. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g,
    (entity, body: string) => {
      if (!body.startsWith('#')) return NAMED_ENTITIES[body] ?? entity;
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : '�';
    },
  );
}
