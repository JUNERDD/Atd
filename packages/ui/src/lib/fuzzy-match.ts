import fuzzysort from 'fuzzysort';

/*
 * The app's search matcher: searchable lists filter, rank, and highlight through this module, and
 * it is the only code that touches fuzzysort, so upgrading the library changes this file alone.
 *
 * Query and fields are NFC-normalized. The query splits on whitespace into distinct words, each
 * matched on its own, so words may match in any order and in different fields:
 * - A word counts for a field when fuzzysort scores it at MIN_MATCH_SCORE or above. Every field it
 *   counts for is highlighted, not only the best one.
 * - A word of two or more characters that appears verbatim (ignoring case and accents) also counts,
 *   at exactly MIN_MATCH_SCORE. fuzzysort's position and length penalties otherwise rate such a
 *   word deep in a long memory entry or description as noise, which substring search used to find.
 * An item matches when every word counts for at least one field. Its score is the mean of each
 * word's best field score, so a one-word query scores exactly fuzzysort's best field score.
 */

/** `[from, to)` UTF-16 offsets into the NFC form of the matched field text. */
export type MatchRange = readonly [from: number, to: number];

/** Scores are fuzzysort's 0–1; below this a match is scattered noise. */
export const MIN_MATCH_SCORE = 0.5;

export interface FieldsMatch<K extends string> {
  /** 0–1 relevance of the whole item. */
  score: number;
  /** Sorted, non-overlapping ranges per field; an empty array for a field with no range. */
  ranges: Readonly<Record<K, readonly MatchRange[]>>;
}

/**
 * Null for a blank query or no match. Undefined fields never match. Space-separated words may
 * match in any order and in different fields. Matching is NFC-normalized and accent-insensitive.
 */
export function matchFields<K extends string>(
  query: string,
  fields: Readonly<Record<K, string | undefined>>,
): FieldsMatch<K> | null {
  return matchWords(queryWords(query), fields);
}

/**
 * Matching items, best first, equal scores in source order. A blank query keeps every item,
 * in source order, with `match: null`.
 */
export function rankByQuery<T, K extends string>(
  items: readonly T[],
  query: string,
  fields: (item: T) => Readonly<Record<K, string | undefined>>,
): { item: T; match: FieldsMatch<K> | null }[] {
  const words = queryWords(query);
  if (!words.length) return items.map((item) => ({ item, match: null }));
  return items
    .flatMap((item, index) => {
      const match = matchWords(words, fields(item));
      return match ? [{ item, match, index }] : [];
    })
    .sort((a, b) => b.match.score - a.match.score || a.index - b.index)
    .map(({ item, match }) => ({ item, match }));
}

/**
 * Combining marks, which fuzzysort 4 folds only inside a character whose NFKD form minus these
 * marks is one UTF-16 unit. A mark NFC leaves on its own (x with U+0302, Cyrillic stress marks)
 * would stay a unit between letters and break contiguous and verbatim matches, so it is removed
 * before matching; `nfcOffset` maps fuzzysort's indexes back.
 */
const FOLDED_MARKS = /[\u0300-\u036f]/gu;

/** fuzzysort 4's fixed remappings (its `remapFrom` / `remapTo`), applied before case folding. */
const REMAP_FROM = '\\"`‘’‚‛“”„‟«»‹›‐–—−⁄∕…øØłŁđĐðÐıħĦŧŦ';
const REMAP_TO = "/''''''''''''''----//.oOlLdDdDihHtT";

interface Word {
  /** NFC without folded marks, as passed to fuzzysort. */
  text: string;
  /** `text` in fuzzysort's comparison form, for the verbatim search. */
  folded: string;
  /** Two or more characters, so a verbatim occurrence counts (see the module comment). */
  verbatim: boolean;
}

/** One defined field, prepared per call; fuzzysort's own string cache would grow for good. */
interface Field {
  nfc: string;
  /** `nfc` without folded marks; fuzzysort's indexes point into it. */
  text: string;
  prepared: ReturnType<typeof fuzzysort.prepare>;
  /** Units of `text` highlighted for any word. */
  units: Set<number>;
}

/** The query's distinct words; none for a blank query. */
function queryWords(query: string): Word[] {
  const words = new Map<string, Word>();
  for (const text of query.normalize('NFC').replace(FOLDED_MARKS, '').split(/\s+/u)) {
    const folded = fold(text);
    if (text && !words.has(folded)) {
      words.set(folded, { text, folded, verbatim: Array.from(text).length > 1 });
    }
  }
  return [...words.values()];
}

/**
 * fuzzysort 4's comparison form: a remapped unit takes its replacement, and any other UTF-16 unit
 * outside ASCII becomes its NFKD form without folded marks when that is a single unit (accents,
 * fullwidth forms); then lower case. Keeps the length of its input, so offsets carry over.
 */
function fold(text: string): string {
  // No `u` flag: fuzzysort remaps code units, so astral characters stay as they are.
  return text
    .replace(/[\u0080-\uffff\\"`]/g, (unit) => {
      const remapped = REMAP_FROM.indexOf(unit);
      if (remapped >= 0) return REMAP_TO.charAt(remapped);
      const base = unit.normalize('NFKD').replace(FOLDED_MARKS, '');
      return base.length === 1 ? base : unit;
    })
    .toLowerCase();
}

function matchWords<K extends string>(
  words: readonly Word[],
  fields: Readonly<Record<K, string | undefined>>,
): FieldsMatch<K> | null {
  if (!words.length) return null;
  const defined: { key: K; field: Field }[] = [];
  for (const key in fields) {
    const value = fields[key];
    if (value) defined.push({ key, field: prepareField(value) });
  }
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const { field } of defined) {
      const hit = matchWord(word, field);
      if (!hit) continue;
      best = Math.max(best, hit.score);
      for (const unit of hit.units) field.units.add(unit);
    }
    if (!best) return null;
    total += best;
  }
  // `for...in` visits every key of `fields`, so each key of K receives an array.
  const ranges = {} as Record<K, readonly MatchRange[]>;
  for (const key in fields) ranges[key] = [];
  for (const { key, field } of defined) ranges[key] = toRanges(field);
  return { score: total / words.length, ranges };
}

function prepareField(value: string): Field {
  const nfc = value.normalize('NFC');
  const text = nfc.replace(FOLDED_MARKS, '');
  return { nfc, text, prepared: fuzzysort.prepare(text), units: new Set() };
}

/** The units of `field.text` that `word` matches and their score, when the field counts. */
function matchWord(word: Word, field: Field): { score: number; units: readonly number[] } | null {
  const result = fuzzysort.single(word.text, field.prepared);
  // No match means not even a subsequence, so no verbatim occurrence either.
  if (!result) return null;
  // A sorted copy; the target's own index buffer is reused by the next `single` call.
  const units = result.indexes;
  if (result.score >= MIN_MATCH_SCORE && !splitsPair(field.text, units)) {
    return { score: result.score, units };
  }
  if (!word.verbatim) return null;
  // Keep fuzzysort's alignment when it is already verbatim (it prefers word starts).
  if (units.every((unit, index) => unit - index === units[0])) {
    return { score: MIN_MATCH_SCORE, units };
  }
  const at = fold(field.text).indexOf(word.folded);
  if (at < 0) return null;
  return {
    score: MIN_MATCH_SCORE,
    units: Array.from({ length: word.text.length }, (_, offset) => at + offset),
  };
}

/**
 * Whether `units` take half of a surrogate pair. fuzzysort compares UTF-16 units, so an emoji
 * in the query can "match" halves of two other emoji; that is no match and cannot be highlighted.
 */
function splitsPair(text: string, units: readonly number[]): boolean {
  const taken = new Set(units);
  return units.some((unit) => {
    const code = text.charCodeAt(unit);
    if (code >= 0xd800 && code <= 0xdbff) return !taken.has(unit + 1);
    return code >= 0xdc00 && code <= 0xdfff && !taken.has(unit - 1);
  });
}

/** The field's highlighted units merged into contiguous runs, as NFC ranges. */
function toRanges(field: Field): MatchRange[] {
  const runs: [number, number][] = [];
  for (const unit of [...field.units].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[1] === unit) last[1] = unit + 1;
    else runs.push([unit, unit + 1]);
  }
  const offset = nfcOffset(field);
  return runs.map(([from, to]): MatchRange => [offset(from), offset(to)]);
}

/**
 * Maps an offset in `field.text` to `field.nfc`. An end offset maps to the next kept unit, so a
 * range also covers the folded marks that follow its last character.
 */
function nfcOffset({ nfc, text }: Field): (offset: number) => number {
  if (nfc.length === text.length) return (offset) => offset;
  // `text` is `nfc` minus folded marks and keeps none of them, so a greedy walk pairs the units.
  const kept: number[] = [];
  for (let index = 0; index < nfc.length; index++) {
    if (nfc.charCodeAt(index) === text.charCodeAt(kept.length)) kept.push(index);
  }
  return (offset) => kept[offset] ?? nfc.length;
}
