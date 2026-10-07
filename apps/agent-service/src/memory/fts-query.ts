/*
 * Adapted from pi-hermes-memory 0.9.9 (MIT, © 2025 Chandra Teja): src/store/fts-query.ts.
 * Changes: queries are always natural language (every term quoted, no raw FTS5 operators), edge
 * punctuation is trimmed, and the stop words also filter the LIKE terms unless none would remain.
 *
 * Copyright (c) 2025 Chandra Teja
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/** A quoted phrase or a run of non-space characters. */
const TOKEN = /"([^"]*)"|(\S+)/g;
const CONNECTORS = new Set(['and', 'or', 'not', 'near']);
const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
/** Terms of one query beyond this are ignored, which bounds the size of a search statement. */
export const MAX_TERMS = 8;

/**
 * High-frequency English function words: they would dominate a ranking or turn an AND search into
 * a miss, so queries drop them (and derived memory names skip them).
 */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  `a an the is are was were be been being have has had do does did will would could should may
   might shall dare ought used i me my mine we our ours you your yours he him his she her hers
   it its they them their theirs that this these those what which who whom whose when where why
   how all each every both few more most other some such no nor not only own same so than too
   very s t just don now about above after again against am at before behind below between by
   during from further into over per through throughout till to under until up upon via with
   within without as if or but and out of for in on any got here there`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * The search terms of a natural-language query: quoted phrases kept whole, connector words
 * dropped, stop words dropped unless nothing else remains, duplicates removed.
 */
export function searchTerms(query: string): string[] {
  const all: string[] = [];
  const meaningful: string[] = [];
  for (const match of query.matchAll(TOKEN)) {
    const phrase = match[1];
    const term = (phrase ?? (match[2] ?? '').replace(EDGE_PUNCTUATION, '')).trim();
    if (!term) continue;
    const lower = term.toLowerCase();
    if (phrase === undefined && CONNECTORS.has(lower)) continue;
    all.push(term);
    if (phrase !== undefined || !STOP_WORDS.has(lower)) meaningful.push(term);
  }
  const terms = meaningful.length ? meaningful : all;
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

/** Whether the trigram tokenizer can match `term`: it indexes runs of three characters. */
export function trigramMatchable(term: string): boolean {
  return Array.from(term).length >= 3;
}

/** An FTS5 query matching every term (`AND`) or any of them (`OR`), each quoted as a phrase. */
export function ftsMatch(terms: readonly string[], joiner: 'AND' | 'OR'): string {
  return terms
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(joiner === 'AND' ? ' ' : ' OR ');
}

/** A LIKE pattern matching `term` anywhere, with `\` escaping the wildcards. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * The passage of a hit to show: around the first term found in the body, else in the
 * description, else the start of the body, on one line and at most `width` characters.
 */
export function snippetFor(
  unit: { description: string; body: string },
  terms: readonly string[],
  width = 160,
): string {
  for (const text of [unit.body, unit.description]) {
    const flat = text.replace(/\s+/g, ' ').trim();
    const lower = flat.toLowerCase();
    const found = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((at) => at >= 0);
    if (found.length) return excerpt(flat, Math.min(...found), width);
  }
  return excerpt(unit.body.replace(/\s+/g, ' ').trim(), 0, width);
}

function excerpt(text: string, at: number, width: number): string {
  const start = Math.max(0, Math.min(at - Math.floor(width / 3), text.length - width));
  const end = Math.min(text.length, start + width);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
