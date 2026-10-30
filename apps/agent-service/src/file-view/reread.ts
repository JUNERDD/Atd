import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import {
  DEFAULT_MAX_LINES,
  type AgentToolResult,
  type ExtensionContext,
  type ReadToolDetails,
} from '@earendil-works/pi-coding-agent';
import {
  lastView,
  versionOf,
  versionSize,
  type FileVersion,
  type ReadRange,
  type ViewSession,
} from './ledger.js';

/**
 * Repeated reads answered from the conversation itself. When a session reads lines of a file that
 * an earlier read of its own returned, the file is still that version, and that earlier result is
 * still in the session's model context exactly as it was returned, the read answers with a short
 * stub that points to it instead of sending the text again. Pruned, compacted or rewound results
 * are no longer in that context (pi's session projection applies context edits and compaction and
 * follows the current branch), so they never count. Only text that provably is the file's own
 * lines counts: the earlier result must equal those lines of the current file, read as UTF-8, so a
 * converted document, an extraction failure, an image or any output the read tool shapes
 * differently is always read again. Calls a codemode script makes never get a stub (their result
 * goes to the script, not the model; the caller checks that).
 */

/** The largest file whose repeated reads are checked; a larger one is always read again. */
const CHECKED_BYTES = 8 * 1024 * 1024;

/** The lines a read asks for: its first line, its line limit, and its other arguments. */
interface ReadWindow {
  from: number;
  limit: number | undefined;
  extra: string;
}

/** What a stub's details record: the earlier call and the lines it returned. */
export interface UnchangedRead {
  toolCallId: string;
  from: number;
  to: number;
}

type Content = (TextContent | ImageContent)[];
type Projection = Pick<ExtensionContext['sessionManager'], 'buildSessionProjection'>;

/** The window of a read's arguments as pi's read applies them; null for arguments it cannot. */
export function readWindow(args: Record<string, unknown>): ReadWindow | null {
  const { path: _path, offset, limit, ...rest } = args;
  if (offset !== undefined && !Number.isInteger(offset)) return null;
  if (limit !== undefined && !(Number.isInteger(limit) && Number(limit) > 0)) return null;
  // pi starts at `offset` when it is 1 or more, at the first line otherwise.
  const from = typeof offset === 'number' && offset > 1 ? offset : 1;
  const extra = JSON.stringify(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));
  return { from, limit: typeof limit === 'number' ? limit : undefined, extra };
}

/**
 * The lines a read returned, from its window and pi's truncation details (`ReadToolDetails`); a
 * window the details leave unclear is kept as asked, since a stub is only ever given after the
 * earlier text matched the file's lines. Null for a result that is not plain text or whose first
 * line alone was over the limit (no lines were shown).
 */
export function readRange(
  window: ReadWindow,
  result: AgentToolResult<unknown>,
  toolCallId: string,
): ReadRange | null {
  const text = textOf(result.content);
  if (text === null) return null;
  const truncation = isRecord(result.details) ? result.details.truncation : undefined;
  let to = window.limit === undefined ? Infinity : window.from + window.limit - 1;
  if (isRecord(truncation) && truncation.firstLineExceedsLimit === true) return null;
  if (isRecord(truncation) && truncation.truncated === true) {
    const shown = truncation.outputLines;
    if (typeof shown !== 'number' || !Number.isInteger(shown) || shown < 1) return null;
    to = window.from + shown - 1;
  }
  return { from: window.from, to, toolCallId, digest: digestOf(text), extra: window.extra };
}

/** The stub for a repeated read by `session` of the file at `real`; null when it must be read. */
export async function unchangedRead(
  session: ViewSession,
  real: string,
  args: Record<string, unknown>,
  context: Projection,
): Promise<AgentToolResult<ReadToolDetails & { unchanged: UnchangedRead }> | null> {
  const view = lastView(session, real);
  const window = readWindow(args);
  if (!view || !window) return null;
  const candidates = view.ranges.filter(
    (range) => range.extra === window.extra && range.from <= window.from,
  );
  if (!candidates.length || (await versionOf(real)) !== view.version) return null;
  const file = await linesOf(real, view.version);
  if (!file || window.from > file.lines.length) return null;
  const { lines } = file;
  const to = Math.min(window.from + (window.limit ?? DEFAULT_MAX_LINES) - 1, lines.length);
  const results = earlierResults(context, new Set(candidates.map((range) => range.toolCallId)));
  for (const range of candidates.toReversed()) {
    const end = Math.min(range.to, lines.length);
    const text = results.get(range.toolCallId);
    if (to > end || text === undefined || digestOf(text) !== range.digest) continue;
    const shown = lines.slice(range.from - 1, end).join('\n');
    // Through the end of a file whose last line ends in a line break, pi's own read keeps it.
    const whole = end === lines.length && file.finalBreak ? `${shown}\n` : null;
    if (!showsLines(text, shown) && (whole === null || !showsLines(text, whole))) continue;
    const stub = `[Unchanged since your earlier read of lines ${range.from}–${end} in this conversation; that result is still current.]`;
    // A stub longer than the lines it stands for saves nothing.
    if (stub.length >= lines.slice(window.from - 1, to).join('\n').length) return null;
    const unchanged = { toolCallId: range.toolCallId, from: range.from, to: end };
    return { content: [{ type: 'text', text: stub }], details: { unchanged } };
  }
  return null;
}

/**
 * The file's lines as `read` numbers them, if it is still `version`, small and UTF-8: split at
 * line breaks, a final break ending the last line rather than starting another
 * (file-loader/read-tool.ts).
 */
async function linesOf(
  real: string,
  version: FileVersion,
): Promise<{ lines: string[]; finalBreak: boolean } | null> {
  if (versionSize(version) > CHECKED_BYTES) return null;
  const bytes = await readFile(real).catch(() => null);
  if (!bytes || !isUtf8(bytes) || (await versionOf(real)) !== version) return null;
  const text = bytes.toString('utf8');
  const finalBreak = text.endsWith('\n');
  return { lines: (finalBreak ? text.slice(0, -1) : text).split('\n'), finalBreak };
}

/** Whether a read's text is exactly `lines`, alone or followed by one of read's notes. */
function showsLines(text: string, lines: string): boolean {
  return text === lines || text.startsWith(`${lines}\n\n[`);
}

/** The text of each wanted read result still in the session's model context, unless an error. */
function earlierResults(context: Projection, wanted: ReadonlySet<string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const message of context.buildSessionProjection().messages) {
    if (message.role !== 'toolResult' || message.isError || !wanted.has(message.toolCallId))
      continue;
    const text = textOf(message.content);
    if (text !== null) found.set(message.toolCallId, text);
  }
  return found;
}

/** A result's text when it holds nothing but text. */
function textOf(content: Content): string | null {
  const parts: string[] = [];
  for (const part of content) {
    if (part.type !== 'text') return null;
    parts.push(part.text);
  }
  return parts.join('\n');
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
