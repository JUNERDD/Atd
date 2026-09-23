import path from 'node:path';
import {
  attachableExtension,
  MAX_ATTACHMENT_BYTES,
  type AttachableExtension,
} from '../agent/attachable-files';
import type { SearchHit } from './backend';
import { searchableLocation, type SearchScope } from './scope';

/** A hit the renderer may be offered, with the name and location it will see. */
export interface Candidate {
  hit: SearchHit;
  name: string;
  location: string;
  extension: AttachableExtension;
}

/** How the query matches, best first; `folder` means only a parent folder name matched. */
type Tier = 'exact' | 'prefix' | 'wordStart' | 'substring' | 'folder';

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
  return nameTier(foldText(query), name) !== null;
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
export function rankCandidates(query: string, candidates: Candidate[], now: number): Candidate[] {
  const folded = foldText(query);
  const scored: Array<{
    candidate: Candidate;
    score: number;
    used: boolean;
    recency: number;
    last: boolean;
  }> = [];
  for (const candidate of candidates) {
    const recency = latest(candidate.hit.usedAt, candidate.hit.modifiedAt) ?? 0;
    let score = 0;
    if (folded) {
      const tier = nameTier(folded, candidate.name) ?? folderTier(folded, candidate.location);
      if (!tier) continue;
      score =
        TIER_SCORES[tier] + recencyBoost(now - recency) - placementPenalty(candidate.location);
    }
    const used = candidate.hit.usedAt !== null;
    scored.push({ candidate, score, used, recency, last: tooLarge(candidate.hit) });
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
  return scored.map((entry) => entry.candidate);
}

function nameTier(query: string, name: string): Tier | null {
  const { folded, starts } = foldName(name);
  const dot = folded.lastIndexOf('.');
  if (folded === query || (dot > 0 && folded.slice(0, dot) === query)) return 'exact';
  if (folded.startsWith(query)) return 'prefix';
  if (starts.some((start) => folded.startsWith(query, start))) return 'wordStart';
  return folded.includes(query) ? 'substring' : null;
}

function folderTier(query: string, location: string): Tier | null {
  return foldText(location).includes(query) ? 'folder' : null;
}

/**
 * The folded name and where its words start: after `-`, `_`, `.`, spaces or other separators, and
 * at camelCase humps. ASCII names, the common case, skip Unicode normalization.
 */
function foldName(name: string): { folded: string; starts: number[] } {
  const starts: number[] = [];
  if (ASCII.test(name)) {
    let previous = -1;
    for (let index = 0; index < name.length; index += 1) {
      const code = name.charCodeAt(index);
      const hump = isLowerAscii(previous) && isUpperAscii(code);
      if (isWordAscii(code) && (!isWordAscii(previous) || hump)) starts.push(index);
      previous = code;
    }
    return { folded: name.toLowerCase(), starts };
  }
  let folded = '';
  let previous = '';
  for (const char of name) {
    const piece = foldChar(char);
    const hump = /\p{Ll}/u.test(previous) && /\p{Lu}/u.test(char);
    const word = /[\p{L}\p{N}\p{M}]/u.test(char);
    if (piece && word && (!/[\p{L}\p{N}\p{M}]/u.test(previous) || hump)) starts.push(folded.length);
    folded += piece;
    previous = char;
  }
  return { folded, starts };
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
