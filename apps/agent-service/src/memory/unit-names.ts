import type { MemoryTarget } from '@atd/agent-contracts';
import { STOP_WORDS } from './fts-query.js';

/**
 * Unit names follow the Agent Skills name rule, as skills do: lowercase ASCII letters and digits in
 * hyphen-separated words, at most 64 characters, unique among the units. The model reads and
 * changes units by name, so a missing or clashing name is derived or suffixed, never refused,
 * except in Settings where the user typed it.
 */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_NAME_LENGTH = 64;
/** Room a derived name leaves for a `-<n>` suffix and for reading in a list. */
const DERIVED_LENGTH = 48;
/** Words of a description a derived name keeps. */
const DERIVED_WORDS = 5;

export function isMemoryName(name: string): boolean {
  return name.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name);
}

/** The ASCII words of `text`, lowercase, with diacritics folded (é → e); other text separates. */
function asciiWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Hyphenates whole words up to `max` characters; only a first word longer than that is cut. */
function joinWords(words: readonly string[], max: number): string {
  let name = '';
  for (const word of words) {
    const next = name ? `${name}-${word}` : word;
    if (next.length > max) return name || word.slice(0, max);
    name = next;
  }
  return name;
}

/** A name from text a tool or learner offered as one; empty when it holds no ASCII word. */
export function slugifyName(text: string): string {
  return joinWords(asciiWords(text), MAX_NAME_LENGTH);
}

/** `base`, or the first of `base-2`, `base-3`… that is free, within the length limit. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const stem = base.slice(0, MAX_NAME_LENGTH - suffix.length).replace(/-+$/, '');
    const candidate = `${stem}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The name of a unit that has none: the first meaningful ASCII words of its description, made
 * unique; a description without such words (Chinese, for one) gives the first free `<type>-<n>`.
 */
export function deriveName(
  description: string,
  type: MemoryTarget,
  taken: ReadonlySet<string>,
): string {
  const words = asciiWords(description);
  const meaningful = words.filter((word) => !STOP_WORDS.has(word));
  const base = joinWords(
    (meaningful.length ? meaningful : words).slice(0, DERIVED_WORDS),
    DERIVED_LENGTH,
  );
  if (base) return uniqueName(base, taken);
  for (let n = 1; ; n += 1) {
    const candidate = `${type}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
