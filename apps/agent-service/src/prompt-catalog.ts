/**
 * Catalog text for a system prompt section: a preamble, a tagged list of entries and a totals
 * line, fitted to a character budget. The skill catalog (skills/skill-catalog.ts) and a run's
 * memory index (memory/run-memory.ts) render through it, so both shrink the same way and keep
 * exact totals.
 */

/** A longer description is cut here, before any entry loses its description. */
const MAX_DESCRIPTION_CHARS = 250;

/** One listed item, rendered with and without its description. */
export interface CatalogEntry {
  full: string;
  bare: string;
}

/** What a catalog section lists and how it words its counts. */
export interface CatalogLayout {
  preamble: string;
  /** The tags around the entries; the list and its tags are left out when there are no entries. */
  open: string;
  close: string;
  entries: readonly CatalogEntry[];
  /** The line that counts the trailing entries left out. */
  omitted: (count: number) => string;
  /**
   * The last line, with exact totals. It may list up to `tail` trailing names; `shown` is how
   * many it lists, and those are the last thing left out.
   */
  totals: (shown: number) => string;
  tail: number;
  maxChars: number;
}

/** A rendered catalog and how many entries it lists, with or without their descriptions. */
export interface CatalogText {
  text: string;
  listed: number;
}

/**
 * Fits a catalog into `maxChars`. Over budget, trailing entries lose their descriptions first,
 * then are left out behind a count line, then the totals line lists fewer trailing names. When
 * even that does not fit, the most reduced text comes back over budget; the caller decides.
 */
export function renderCatalog(layout: CatalogLayout): CatalogText {
  const { entries, maxChars } = layout;
  // Entries [0, withDescription) keep descriptions, [withDescription, shown) are names only.
  let withDescription = entries.length;
  let shown = entries.length;
  let tailShown = layout.tail;
  const render = (): string => {
    const listed = [
      ...entries.slice(0, withDescription).map((entry) => entry.full),
      ...entries.slice(withDescription, shown).map((entry) => entry.bare),
    ];
    const omitted = entries.length - shown;
    return [
      layout.preamble,
      ...(entries.length ? [layout.open, ...listed, layout.close] : []),
      ...(omitted ? [layout.omitted(omitted)] : []),
      layout.totals(tailShown),
    ].join('\n');
  };
  // Dropping a description changes only its entry, so that loop tracks the length by deltas.
  let length = render().length;
  while (length > maxChars && withDescription > 0) {
    withDescription -= 1;
    const entry = entries[withDescription];
    length -= (entry?.full.length ?? 0) - (entry?.bare.length ?? 0);
  }
  while (length > maxChars && shown > 0) {
    shown -= 1;
    length = render().length;
  }
  while (length > maxChars && tailShown > 0) {
    tailShown -= 1;
    length = render().length;
  }
  return { text: render(), listed: shown };
}

/** A description as a catalog lists it: on one line, cut at MAX_DESCRIPTION_CHARS. */
export function catalogDescription(description: string): string {
  const text = description.replace(/\s+/g, ' ').trim();
  return text.length > MAX_DESCRIPTION_CHARS
    ? `${text.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`
    : text;
}

/** `word` for a count of one, otherwise `many` (`word` and "s" unless given). */
export function plural(count: number, word: string, many = `${word}s`): string {
  return count === 1 ? word : many;
}

/** Escapes text placed inside a catalog's elements. */
export function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
