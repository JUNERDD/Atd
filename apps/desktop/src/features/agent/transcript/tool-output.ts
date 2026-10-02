/**
 * Parsers for the plain-text results of Pi's built-in tools (pi-coding-agent `core/tools`), shared
 * by the row summaries and the expanded bodies. Tool text is untrusted: every parser returns `null`
 * (or leaves the text whole) when the shape does not match, and callers fall back to showing the
 * text as is.
 */

/** Pi's closing notices: a blank line, then one bracketed paragraph (`[Showing lines 1-20 …]`). */
const NOTICE = /\n\n\[([^\n]*)\]\s*$/;

/** The text without Pi's trailing bracketed notice, and the notice's inner text when present. */
export function splitNotice(text: string): { body: string; notice: string | null } {
  const match = NOTICE.exec(text);
  if (!match || match.index === undefined) return { body: text, notice: null };
  return { body: text.slice(0, match.index), notice: match[1] ?? null };
}

/** `bash` appends its exit status as the last paragraph when the command did not exit 0. */
const EXIT_LINE = /\n*Command (?:exited with code (\d+)|terminated without an exit code)\s*$/;

/**
 * A `bash` result split into its output and exit status. `exitCode` is the reported non-zero code,
 * `null` when the shell reported none (killed), and `undefined` when no status line was appended
 * (the command exited 0, or is still running).
 */
export function splitBashExit(text: string): { body: string; exitCode: number | null | undefined } {
  const match = EXIT_LINE.exec(text);
  if (!match || match.index === undefined) return { body: text, exitCode: undefined };
  return { body: text.slice(0, match.index), exitCode: match[1] ? Number(match[1]) : null };
}

export interface GrepLine {
  line: number;
  text: string;
  /** False for a context line (`path-12- text`) printed around a match. */
  match: boolean;
}

export interface GrepFile {
  path: string;
  lines: GrepLine[];
}

/** Matches print `path:12: text`; context lines print `path-12- text`. */
const GREP_MATCH = /^(.+?):(\d+): ?(.*)$/;
const GREP_CONTEXT = /^(.+?)-(\d+)- ?(.*)$/;

/**
 * A `grep` result grouped by file in output order, with its match count. `null` for "No matches
 * found", an empty body, or any line that is not a match, a context line, or a block separator.
 */
export function parseGrep(text: string): { files: GrepFile[]; matchCount: number } | null {
  const { body } = splitNotice(text);
  const files: GrepFile[] = [];
  let matchCount = 0;
  for (const raw of body.split('\n')) {
    if (raw === '' || raw === '--') continue;
    const match = GREP_MATCH.exec(raw);
    const context = match ? null : GREP_CONTEXT.exec(raw);
    const parts = match ?? context;
    if (!parts) return null;
    const [, path = '', line = '0', lineText = ''] = parts;
    const entry: GrepLine = { line: Number(line), text: lineText, match: Boolean(match) };
    if (match) matchCount += 1;
    const last = files.at(-1);
    if (last?.path === path) last.lines.push(entry);
    else files.push({ path, lines: [entry] });
  }
  return files.length > 0 ? { files, matchCount } : null;
}

/** Pi's empty-result sentences for `find` and `ls`. */
const EMPTY_LISTING = new Set(['No files found matching pattern', '(empty directory)']);

/**
 * A `find` or `ls` result as its entries (directories keep their trailing `/`), plus the notice.
 * `entries` is empty for Pi's empty-result sentence.
 */
export function parseListing(text: string): { entries: string[]; notice: string | null } {
  const { body, notice } = splitNotice(text);
  const trimmed = body.trim();
  if (trimmed === '' || EMPTY_LISTING.has(trimmed)) return { entries: [], notice };
  return { entries: trimmed.split('\n').filter((entry) => entry.trim() !== ''), notice };
}

/** Added and removed line counts of Pi's numbered edit diff (`+12 text`, `-12 text`). */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (/^\+\s*\d/.test(line)) added += 1;
    else if (/^-\s*\d/.test(line)) removed += 1;
  }
  return { added, removed };
}

/** Pi's `read` continuation notices (`Showing lines 1-2000 of 5000. …`, `12 more lines in file. …`). */
const SHOWING_LINES = /^Showing lines (\d+)-(\d+) of (\d+)\b/;
const MORE_LINES = /^(\d+) more lines? in file\b/;

/**
 * The lines a truncated `read` returned (`showing`), or how many lines remain after a limited one
 * (`more`), from the inner text of its notice (`splitNotice`). `null` for any other notice.
 */
export function parseReadNotice(
  notice: string,
):
  | { kind: 'showing'; start: number; end: number; total: number }
  | { kind: 'more'; count: number }
  | null {
  const showing = SHOWING_LINES.exec(notice);
  if (showing) {
    const [, start = '0', end = '0', total = '0'] = showing;
    return { kind: 'showing', start: Number(start), end: Number(end), total: Number(total) };
  }
  const more = MORE_LINES.exec(notice);
  return more ? { kind: 'more', count: Number(more[1]) } : null;
}
