import type { TaskSearchHit, TaskSearchRange } from '@atd/agent-contracts';
import type { SearchMessage } from './search-text.js';

/** Characters of a hit's single-line excerpt, ellipses aside. */
const SNIPPET_WIDTH = 160;
/**
 * Characters kept before the first match. The history row shows the snippet on one truncated line
 * of about 50 Latin or 28 CJK characters, so the match must sit near its start to be seen.
 */
const SNIPPET_LEAD = 12;
/** Ranges one snippet reports at most (TaskSearchHitSchema). */
const MAX_RANGES = 64;

/** One query term, compiled once per search. */
export interface SearchTerm {
  /** Whether a text contains the term anywhere; stateless (no `g` flag). */
  test: RegExp;
  /** Every occurrence of the term, for highlight ranges. */
  all: RegExp;
}

/**
 * A query's terms: NFC-normalized, split on whitespace, without empties or case-insensitive
 * duplicates. Each matches as a case-insensitive substring, so a term of CJK text needs no word
 * segmentation. Memory's `searchTerms` is not reused: it drops stop words and reads quoted
 * phrases, while history search matches exactly the words typed (TaskSearchQuerySchema).
 */
export function queryTerms(query: string): SearchTerm[] {
  const seen = new Set<string>();
  const terms: SearchTerm[] = [];
  for (const word of query.normalize('NFC').trim().split(/\s+/u)) {
    const folded = word.toLowerCase();
    if (!word || seen.has(folded)) continue;
    seen.add(folded);
    const source = RegExp.escape(word);
    terms.push({ test: new RegExp(source, 'iu'), all: new RegExp(source, 'giu') });
  }
  return terms;
}

/**
 * A task's hit when every term occurs somewhere across its messages, else null: the message with
 * the most distinct terms, the earliest on a tie, as an excerpt around its first match.
 */
export function matchTask(
  taskId: string,
  messages: readonly SearchMessage[],
  terms: readonly SearchTerm[],
): TaskSearchHit | null {
  if (!terms.length) return null;
  const found = new Set<SearchTerm>();
  let best: SearchMessage | undefined;
  let bestCount = 0;
  for (const message of messages) {
    let count = 0;
    for (const term of terms)
      if (term.test.test(message.text)) {
        count += 1;
        found.add(term);
      }
    if (count > bestCount) {
      best = message;
      bestCount = count;
    }
  }
  if (!best || found.size < terms.length) return null;
  const snippet = snippetOf(best.text, terms);
  return { taskId, role: best.role, snippet, ranges: rangesIn(snippet, terms) };
}

/**
 * The message on one line, cut to an excerpt starting `SNIPPET_LEAD` characters before its first
 * match, with an ellipsis on each side that was cut.
 */
function snippetOf(text: string, terms: readonly SearchTerm[]): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  const offsets = terms.map((term) => flat.search(term.test)).filter((at) => at >= 0);
  const at = offsets.length ? Math.min(...offsets) : 0;
  const start = characterStart(flat, Math.max(0, at - SNIPPET_LEAD));
  const end = characterStart(flat, Math.min(flat.length, start + SNIPPET_WIDTH));
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** `index`, moved back off the second half of a surrogate pair so a cut never splits a character. */
function characterStart(text: string, index: number): number {
  const unit = text.charCodeAt(index);
  return index > 0 && unit >= 0xdc00 && unit <= 0xdfff ? index - 1 : index;
}

/**
 * Every term occurrence in `snippet` as UTF-16 `[from, to)` offsets into it, sorted, with
 * overlapping occurrences merged; terms the excerpt cut off at either end are not reported.
 */
function rangesIn(snippet: string, terms: readonly SearchTerm[]): TaskSearchRange[] {
  const occurrences: TaskSearchRange[] = [];
  for (const term of terms)
    for (const match of snippet.matchAll(term.all))
      occurrences.push([match.index, match.index + match[0].length]);
  occurrences.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: TaskSearchRange[] = [];
  for (const [from, to] of occurrences) {
    const last = merged.at(-1);
    if (last && from < last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged.slice(0, MAX_RANGES);
}
