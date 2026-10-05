import { parseDocument } from 'yaml';
import { isRecord, stripBom } from './context.js';

/** A markdown file split into YAML frontmatter and body. */
export interface MarkdownDocument {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Set when a frontmatter block exists but is not a valid YAML mapping. */
  error?: string;
  /** The raw frontmatter source, for lenient fallbacks. */
  source: string;
}

const OPENING = /^---[ \t]*\n/;
const CLOSING = /^---[ \t]*$/m;

/**
 * Splits `---` frontmatter from a markdown file. A file without an opening fence, or with an
 * unterminated one, is all body. Line endings are normalized to `\n`.
 */
export function parseMarkdown(text: string): MarkdownDocument {
  const normalized = stripBom(text).replace(/\r\n?/g, '\n');
  const opening = OPENING.exec(normalized);
  if (!opening) return { frontmatter: {}, body: normalized, source: '' };
  const rest = normalized.slice(opening[0].length);
  const closing = CLOSING.exec(rest);
  if (!closing) return { frontmatter: {}, body: normalized, source: '' };
  const source = rest.slice(0, closing.index);
  const body = rest.slice(closing.index + closing[0].length).replace(/^\n/, '');
  try {
    // parseDocument collects errors instead of throwing or logging; warnings are not fatal.
    const parsed = parseDocument(source);
    const [failure] = parsed.errors;
    if (failure)
      return {
        frontmatter: {},
        body,
        source,
        error: failure.message.split('\n')[0] ?? 'invalid YAML',
      };
    const value: unknown = parsed.toJS();
    if (value === null || value === undefined) return { frontmatter: {}, body, source };
    if (!isRecord(value)) {
      return { frontmatter: {}, body, source, error: 'frontmatter is not a mapping' };
    }
    return { frontmatter: value, body, source };
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { frontmatter: {}, body, source, error: message ?? 'invalid YAML' };
  }
}

/**
 * Reads top-level `key: value` lines as plain strings. Claude still loads agents and commands
 * whose frontmatter is not strict YAML (for example an unquoted `: ` inside a description).
 */
export function lenientFrontmatter(source: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of source.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    const value = (match[2] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
    if (value !== '') result[match[1]] = value;
  }
  return result;
}

/** A non-empty string field, trimmed; undefined otherwise. */
export function stringField(frontmatter: Record<string, unknown>, key: string): string | undefined {
  const value = frontmatter[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** The first non-empty line of a body, trimmed; used as a fallback description. */
export function firstLine(body: string): string | undefined {
  return body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
}

/**
 * Reads a tool or name list written as a YAML list or as a comma- or space-separated string.
 * Separators inside parentheses belong to the entry (`Bash(git add:*)`, `Bash(gh *)`). A missing
 * key or YAML's empty value (`tools:`) names nothing; null means the value is not a list.
 */
export function splitList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === 'string')) return null;
    return (value as string[]).map((entry) => entry.trim()).filter((entry) => entry !== '');
  }
  if (typeof value !== 'string') return null;
  const entries: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current !== '') entries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current !== '') entries.push(current);
  return entries;
}

/**
 * Whether a Claude body contains dynamic context injection: `` !`cmd` `` at a line start or after
 * whitespace, or a ```` ```! ```` fenced block. The kit never runs them.
 */
export function hasShellInjection(body: string): boolean {
  return /(^|\s)!`[^`\n]+`/m.test(body) || /^[ \t]*```!/m.test(body);
}
