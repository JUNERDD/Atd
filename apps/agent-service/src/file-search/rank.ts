import path from 'node:path';
import {
  attachableExtension,
  MAX_ATTACHMENT_BYTES,
  type AttachableExtension,
} from '@ai/agent-contracts';
import type { SearchHit } from './backend.js';
import { searchableLocation, type SearchScope } from './scope.js';

/** A hit the renderer may be offered, with the name and location it will see. */
export interface Candidate {
  hit: SearchHit;
  name: string;
  location: string;
  extension: AttachableExtension;
}

/** `[from, to)` UTF-16 offsets into the NFC name, the text the renderer highlights. */
export type NameRange = readonly [from: number, to: number];

/** A candidate in rank order, with where the query matched its name. */
export interface Ranked {
  candidate: Candidate;
  /** Null for an empty query, and when only a parent folder name matched. */
  match: NameRange | null;
}

/** How the query matches, best first; `folder` means only a parent folder name matched. */
type Tier = 'exact' | 'prefix' | 'wordStart' | 'substring' | 'folder';

/** A name tier and the occurrence that earned it. */
interface NameMatch {
  tier: Tier;
  range: NameRange;
}

/** A file name folded for matching, as `foldName` returns it. */
interface FoldedName {
  /** The NFC name, which ranges point into. */
  text: string;
  /** `text` folded like `foldText`. */
  folded: string;
  /** Where words start in `folded`. */
  starts: number[];
  /**
   * For each code unit of `folded`, the offset in `text` of the character it came from. Null for
   * ASCII names, which fold unit for unit.
   */
  origins: number[] | null;
}

/** Tiers dominate: boosts and penalties only reorder files within about one tier. */
const TIER_SCORES: Record<Tier, number> = {
  exact: 5000,
  prefix: 4000,
  wordStart: 3000,
  substring: 2000,
  folder: 1000,
};
const DAY_MS = 24 * 60 * 60 * 1000;
/** Used or modified within 1, 7 or 30 days. */
const RECENCY_BOOSTS: ReadonlyArray<readonly [number, number]> = [
  [DAY_MS, 300],
  [7 * DAY_MS, 200],
  [30 * DAY_MS, 100],
];
const DEPTH_PENALTY = 20;
/** Output and cache folders that the scope keeps searchable but that rarely hold user files. */
const NOISY_FOLDERS = new Set([
  'tmp',
  'temp',
  'cache',
  'caches',
  'log',
  'logs',
  'vendor',
  'obj',
  'bin',
  'pods',
  'artifacts',
]);
const NOISY_PENALTY = 500;
/** No code unit above U+007F: folding is plain lowercasing. */
const ASCII = /^[^\u0080-￿]*$/;

/** Case- and accent-insensitive form (Spotlight's `cd`), folded per character. */
export function foldText(value: string): string {
  if (ASCII.test(value)) return value.toLowerCase();
  let folded = '';
  for (const char of value) folded += foldChar(char);
  return folded;
}

function foldChar(char: string): string {
  return char
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** Whether a file name contains the query at all; `query` is raw user text. */
export function nameMatches(query: string, name: string): boolean {
  const folded = foldText(query);
  return !folded || nameTier(folded, name) !== null;
}

export function tooLarge(hit: SearchHit): boolean {
  return hit.size !== null && hit.size > MAX_ATTACHMENT_BYTES;
}

/**
 * Keeps searchable attachable files and merges one file found twice (for example by a recent pass
 * and a name pass), which works because backends report real paths.
 */
export function candidatesOf(hits: SearchHit[], scope: SearchScope): Candidate[] {
  const byPath = new Map<string, Candidate>();
  for (const hit of hits) {
    const seen = byPath.get(hit.path);
    if (seen) {
      seen.hit = merge(seen.hit, hit);
      continue;
    }
    const extension = attachableExtension(hit.path);
    const location = searchableLocation(scope, hit.path);
    if (!extension || location === null) continue;
    byPath.set(hit.path, { hit, name: path.basename(hit.path), location, extension });
  }
  return [...byPath.values()];
}

/**
 * Orders candidates best first and drops those the query does not match. An empty query lists
 * files the user opened before files that were only modified, each newest first: builds and
 * installs modify many files without anyone opening them. Files too large to attach sort last.
 */
export function rankCandidates(query: string, candidates: Candidate[], now: number): Ranked[] {
  const folded = foldText(query);
  const scored: Array<{
    candidate: Candidate;
    match: NameRange | null;
    score: number;
    used: boolean;
    recency: number;
    last: boolean;
  }> = [];
  for (const candidate of candidates) {
    const recency = latest(candidate.hit.usedAt, candidate.hit.modifiedAt) ?? 0;
    const named = folded ? nameTier(folded, candidate.name) : null;
    let score = 0;
    if (folded) {
      const tier = named?.tier ?? folderTier(folded, candidate.location);
      if (!tier) continue;
      score =
        TIER_SCORES[tier] + recencyBoost(now - recency) - placementPenalty(candidate.location);
    }
    const used = candidate.hit.usedAt !== null;
    const match = named?.range ?? null;
    scored.push({ candidate, match, score, used, recency, last: tooLarge(candidate.hit) });
  }
  scored.sort(
    (a, b) =>
      Number(a.last) - Number(b.last) ||
      b.score - a.score ||
      Number(b.used) - Number(a.used) ||
      b.recency - a.recency ||
      a.candidate.name.length - b.candidate.name.length ||
      (a.candidate.hit.path < b.candidate.hit.path ? -1 : 1),
  );
  return scored.map(({ candidate, match }) => ({ candidate, match }));
}

/** The best tier of a name for a folded, non-empty query, with the occurrence that earned it. */
function nameTier(query: string, name: string): NameMatch | null {
  const fold = foldName(name);
  const { folded, starts } = fold;
  const matchAt = (tier: Tier, from: number): NameMatch => ({
    tier,
    range: nameRange(fold, from, from + query.length),
  });
  const dot = folded.lastIndexOf('.');
  if (folded === query || (dot > 0 && folded.slice(0, dot) === query)) return matchAt('exact', 0);
  if (folded.startsWith(query)) return matchAt('prefix', 0);
  const word = starts.find((start) => folded.startsWith(query, start));
  if (word !== undefined) return matchAt('wordStart', word);
  const index = folded.indexOf(query);
  return index === -1 ? null : matchAt('substring', index);
}

/**
 * The folded units `[from, to)` as a range of the NFC name: the characters they came from, plus
 * the combining marks after the last one, which fold to nothing. A highlight thus never splits a
 * character from its marks, or a Hangul syllable whose jamo only partly matched.
 */
function nameRange({ text, origins }: FoldedName, from: number, to: number): NameRange {
  if (!origins) return [from, to];
  // Origins never decrease, so the extremes are the first and last matched characters.
  const matched = origins.slice(from, to);
  const last = Math.max(...matched);
  // Up to the next character that folds to anything, or the end: the marks between are included.
  const next = origins.slice(to).find((origin) => origin > last);
  return [Math.min(...matched), next ?? text.length];
}

function folderTier(query: string, location: string): Tier | null {
  return foldText(location).includes(query) ? 'folder' : null;
}

/**
 * The folded name and where its words start: after `-`, `_`, `.`, spaces or other separators, and
 * at camelCase humps. ASCII names, the common case, skip Unicode normalization. Other names are
 * walked in NFC, the text the renderer shows: NFC and NFD spellings fold alike, and so a name
 * stored decomposed (common on macOS) ranks and highlights like the name it displays.
 */
function foldName(name: string): FoldedName {
  const starts: number[] = [];
  if (ASCII.test(name)) {
    let previous = -1;
    for (let index = 0; index < name.length; index += 1) {
      const code = name.charCodeAt(index);
      const hump = isLowerAscii(previous) && isUpperAscii(code);
      if (isWordAscii(code) && (!isWordAscii(previous) || hump)) starts.push(index);
      previous = code;
    }
    return { text: name, folded: name.toLowerCase(), starts, origins: null };
  }
  const text = name.normalize('NFC');
  const origins: number[] = [];
  let folded = '';
  let previous = '';
  let offset = 0;
  for (const char of text) {
    const piece = foldChar(char);
    const hump = /\p{Ll}/u.test(previous) && /\p{Lu}/u.test(char);
    const word = /[\p{L}\p{N}\p{M}]/u.test(char);
    if (piece && word && (!/[\p{L}\p{N}\p{M}]/u.test(previous) || hump)) starts.push(folded.length);
    folded += piece;
    // A character can fold to several units (a Hangul syllable to its jamo) or to none (a mark).
    for (let unit = 0; unit < piece.length; unit += 1) origins.push(offset);
    offset += char.length;
    previous = char;
  }
  return { text, folded, starts, origins };
}

function isLowerAscii(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isUpperAscii(code: number): boolean {
  return code >= 65 && code <= 90;
}

function isWordAscii(code: number): boolean {
  return isLowerAscii(code) || isUpperAscii(code) || (code >= 48 && code <= 57);
}

function recencyBoost(age: number): number {
  return RECENCY_BOOSTS.find(([window]) => age <= window)?.[1] ?? 0;
}

/** Deeper files rank lower, and files under output or cache folders lower still. */
function placementPenalty(location: string): number {
  const folders = location ? location.split(path.sep) : [];
  const noisy = folders.some((folder) => NOISY_FOLDERS.has(folder.toLowerCase()));
  return folders.length * DEPTH_PENALTY + (noisy ? NOISY_PENALTY : 0);
}

function merge(first: SearchHit, second: SearchHit): SearchHit {
  return {
    path: first.path,
    size: first.size ?? second.size,
    modifiedAt: latest(first.modifiedAt, second.modifiedAt),
    usedAt: latest(first.usedAt, second.usedAt),
    source: first.source === 'recent' || second.source === 'recent' ? 'recent' : 'search',
  };
}

function latest(first: number | null, second: number | null): number | null {
  if (first === null) return second;
  return second === null ? first : Math.max(first, second);
}
