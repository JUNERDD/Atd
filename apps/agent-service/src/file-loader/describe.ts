import type { Format } from './formats.js';
import { ZIP_LIMITS, type ZipListing } from './zip.js';

/** Entries a zip-family file's description lists. */
const LISTED_ENTRIES = 50;
/** Longest entry name a description repeats. */
const MAX_ENTRY_NAME = 300;

/** A byte count for people: `12 bytes`, `4.2 KB`, `318 MB` (powers of 1,024). */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit] ?? 'TB'}`;
}

/**
 * A file the loader does not turn into text or image input: its kind, size and media type, then
 * `notes` (such as which export would make it readable) and a zip-family file's first entries.
 */
export function describeFile(
  format: Format,
  size: number,
  zip?: ZipListing,
  notes: readonly string[] = [],
): string {
  return [
    `[${format.label} · ${humanSize(size)} · ${format.mime}]`,
    'Its content is not shown as text.',
    ...notes,
    ...entryLines(zip),
  ].join('\n');
}

/**
 * A file whose extraction or conversion failed: `failure` says what (`could not extract its text:
 * <reason>`), followed by the lines a description carries.
 */
export function describeFailure(
  format: Format,
  failure: string,
  zip?: ZipListing,
  notes: readonly string[] = [],
): string {
  return [
    `[${format.label} · ${failure}]`,
    'Its content is not shown as text.',
    ...notes,
    ...entryLines(zip),
  ].join('\n');
}

/** A file that opens only with a password. */
export function describeProtected(format: Format, size: number): string {
  return `[${format.label} · ${humanSize(size)} · password protected]\nIt cannot be read without the password.`;
}

/** `Entries (first 50 of 312):` and one `path (size)` line per listed file; folders are left out. */
function entryLines(zip?: ZipListing): string[] {
  if (!zip) return [];
  const files = zip.entries.filter((entry) => !entry.name.endsWith('/'));
  if (!files.length && !zip.more) return ['The archive is empty.'];
  const count = zip.more
    ? `more than ${ZIP_LIMITS.entries.toLocaleString('en-US')}`
    : files.length.toLocaleString('en-US');
  const heading =
    zip.more || files.length > LISTED_ENTRIES
      ? `Entries (first ${LISTED_ENTRIES} of ${count}):`
      : `Entries (${count}):`;
  return [
    heading,
    ...files
      .slice(0, LISTED_ENTRIES)
      .map((entry) => `${entryName(entry.name)} (${humanSize(entry.size)})`),
  ];
}

/** An entry name on one line: control characters replaced, overlong names shortened. */
function entryName(name: string): string {
  const line = name.replace(/\p{Cc}/gu, '�');
  return line.length > MAX_ENTRY_NAME ? `${line.slice(0, MAX_ENTRY_NAME)}…` : line;
}
