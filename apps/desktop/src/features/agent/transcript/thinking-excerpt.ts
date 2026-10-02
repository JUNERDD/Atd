/**
 * One-line digests of a reasoning trace for its collapsed row (`thinking-block.tsx`). Reasoning
 * is model-written markdown and often structured as section headings, either `**Heading**` lines
 * (reasoning summaries) or ATX `# Heading` lines. Everything here is plain text: markdown syntax
 * is stripped, and the row truncates the result to one line.
 */

/** Bounds the row's DOM text; the row truncates far earlier at any panel width. */
const MAX_EXCERPT = 240;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** A whole line in bold, without an inner `**`; an optional trailing colon is dropped later. */
const BOLD_LINE = /^\*\*((?:(?!\*\*).)+)\*\*$/;
const ATX_LINE = /^#{1,6}\s+(.+?)(?:\s+#+)?$/;
const RULE_LINE = /^([-*_])(?:\s*\1){2,}$/;
const TABLE_LINE = /^\|/;
const LIST_ITEM = /^(?:>\s*)*(?:[-*+]|\d+[.)])\s+/;
const BLOCK_PREFIX = /^(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?/;
/**
 * The first sentence: up to a CJK terminator, or a Latin one at the end or before a word that
 * does not start lowercase, so abbreviations such as `e.g. the` stay inside the sentence.
 */
const SENTENCE = /^(.+?(?:[.!?](?=$|\s+[^\sa-z])|[。！？]))/;
const TRAILING_PUNCTUATION = /[\s.:：。]+$/;

/** Inline markdown reduced to its text: links, images, code, emphasis, strikethrough. */
function plainInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*((?:(?!\*\*).)+)\*\*/g, '$1')
    .replace(/(?<![\w*])\*(\S(?:[^*]*?\S)?)\*(?![\w*])/g, '$1')
    .replace(/(?<!\w)_(\S(?:[^_]*?\S)?)_(?!\w)/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text: string): string {
  const trimmed = text.replace(TRAILING_PUNCTUATION, '');
  return trimmed.length > MAX_EXCERPT ? `${trimmed.slice(0, MAX_EXCERPT).trimEnd()}…` : trimmed;
}

/** The text of a heading line, or null when the line is not one. */
function headingOf(line: string): string | null {
  const match = BOLD_LINE.exec(line) ?? ATX_LINE.exec(line);
  const text = match?.[1] ? plainInline(match[1]) : '';
  return text ? clip(text) : null;
}

/** The trimmed lines outside fenced code; code never names a section or opens the thought. */
function proseLines(text: string, completeOnly: boolean): string[] {
  const lines = text.split('\n');
  // A streaming trace's last line may still grow: `**Plan**` can turn into `**Plan** first, …`.
  if (completeOnly) lines.pop();
  const prose: string[] = [];
  let fence: string | null = null;
  for (const raw of lines) {
    const opener = FENCE.exec(raw)?.[1];
    if (fence) {
      if (opener?.startsWith(fence)) fence = null;
      continue;
    }
    if (opener) {
      fence = opener;
      continue;
    }
    prose.push(raw.trim());
  }
  return prose;
}

/**
 * The newest section heading of a reasoning trace still streaming, or null when the model writes
 * none. Only finished lines count, so a bold opening of a paragraph never flashes as a heading.
 */
export function latestHeading(text: string): string | null {
  const lines = proseLines(text, true);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const heading = headingOf(lines[index] ?? '');
    if (heading) return heading;
  }
  return null;
}

/**
 * A settled trace's one-line digest: its first section heading when the model wrote headings,
 * otherwise the first sentence of its first paragraph. Null when nothing readable remains.
 */
export function thinkingExcerpt(text: string): string | null {
  const lines = proseLines(text, false);
  for (const line of lines) {
    const heading = headingOf(line);
    if (heading) return heading;
  }
  const paragraph: string[] = [];
  for (const line of lines) {
    const skipped = !line || RULE_LINE.test(line) || TABLE_LINE.test(line);
    if (skipped) {
      if (paragraph.length > 0) break;
      continue;
    }
    // Each list item is a paragraph of its own: the first item alone opens the thought.
    if (paragraph.length > 0 && LIST_ITEM.test(line)) break;
    paragraph.push(line.replace(BLOCK_PREFIX, ''));
  }
  const plain = plainInline(paragraph.join(' '));
  if (!plain) return null;
  return clip(SENTENCE.exec(plain)?.[1] ?? plain);
}
