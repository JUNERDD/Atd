import type { BrowserChannel } from './connection.js';
import { truncate } from './text.js';

/**
 * Structured single-line JSONL logger writing exclusively to `process.stderr` (which the Swift
 * shell redirects to `<dataDir>/computer/browser-workers/<id>.log`). `process.stdout` is the
 * private MCP stdio transport and is never written to here.
 */

const MAX_MSG_CHARS = 300;
const MAX_ORIGIN_CHARS = 256;
const MAX_RAW_SCAN_CHARS = 4096;
const SCHEME_PREFIX = /^([A-Za-z][A-Za-z0-9+.-]{0,31}):/;
const CALL_TRACE_AFTER_DASH_RE = /^(?:waiting for\b|fill\(|navigating to\b)/i;
const INLINE_URL_RE =
  /(?<![A-Za-z0-9+.-])(?:(https?):\/\/[^\s"'`<>]+|(wss?|file|chrome-extension|chrome):\/\/[^\s"'`<>]+|(blob):(?:(?:https?|file|chrome-extension):\/\/|null\/)[^\s"'`<>]+|(data):(?:[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+)?(?:;[A-Za-z0-9!#$&^_.+-]+(?:=[A-Za-z0-9!#$&^_.+-]+)?)*,[^\s"'`<>]*)/gi;
const NOT_ADMITTED_RE =
  /not admitted|not allowed|permission denied|denied|unknown target|no target/i;
const CLOSED_RE = /closed|detached|destroyed/i;

export type WorkerLogLevel = 'info' | 'warn' | 'error';

export interface WorkerLogRecord {
  level: WorkerLogLevel;
  cat: string;
  msg: string;
  code?: string | undefined;
  tool?: string | undefined;
  channel?: BrowserChannel | undefined;
  pageId?: string | undefined;
  operationId?: string | undefined;
  origin?: string | undefined;
}

export type WorkerLogWriter = (line: string) => void;

let customWriter: WorkerLogWriter | null = null;

/** Replaces the log sink (for tests); pass `null` to restore `process.stderr`. */
export function setWorkerLogWriter(writer: WorkerLogWriter | null): void {
  customWriter = writer;
}

/** Extracts a concise string message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sanitizes any URL into a privacy-safe origin token:
 * - `http:` and `https:` emit `new URL(u).origin` (no path, query, fragment, or userinfo, <= 256 chars)
 * - non-http(s) URLs emit scheme-only (`chrome:`, `chrome-extension:`, `file:`, `about:`, etc.)
 * - unparseable strings emit scheme-only if a valid RFC 3986 non-http scheme prefix is present, else undefined
 */
export function sanitizeOrigin(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (parsed.origin === 'null') return parsed.protocol;
      return parsed.origin.length > MAX_ORIGIN_CHARS
        ? parsed.origin.slice(0, MAX_ORIGIN_CHARS)
        : parsed.origin;
    }
    return parsed.protocol;
  } catch {
    const match = SCHEME_PREFIX.exec(trimmed);
    if (match === null) return undefined;
    const scheme = `${match[1]!.toLowerCase()}:`;
    return scheme === 'http:' || scheme === 'https:' ? undefined : scheme;
  }
}

function isCallTraceLine(trimmed: string): boolean {
  if (trimmed.length < 3 || trimmed[0] !== '-' || trimmed.charCodeAt(1) > 0x20) return false;
  return CALL_TRACE_AFTER_DASH_RE.test(trimmed.slice(1).trimStart());
}

function findCallLogBoundary(text: string): number {
  let from = 0;
  while (from <= text.length) {
    const idx = text.indexOf('Call log:', from);
    if (idx < 0) return -1;
    if (idx === 0 || text.charCodeAt(idx - 1) <= 0x20) return idx;
    from = idx + 1;
  }
  return -1;
}

function stripPlaywrightCallLog(raw: string): string {
  const bounded = raw.length > MAX_RAW_SCAN_CHARS ? raw.slice(0, MAX_RAW_SCAN_CHARS) : raw;
  const callLogIdx = findCallLogBoundary(bounded);
  const head = callLogIdx >= 0 ? bounded.slice(0, callLogIdx).trimEnd() : bounded;
  if (!head.includes('-')) return head;
  const kept: string[] = [];
  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('Call log:')) break;
    if (isCallTraceLine(trimmed)) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

function splitTrailingUrlPunct(rawMatch: string): { url: string; suffix: string } {
  let parenBalance = 0;
  let bracketBalance = 0;
  let braceBalance = 0;
  for (let i = 0; i < rawMatch.length; i += 1) {
    const ch = rawMatch[i];
    if (ch === '(') parenBalance -= 1;
    else if (ch === ')') parenBalance += 1;
    else if (ch === '[') bracketBalance -= 1;
    else if (ch === ']') bracketBalance += 1;
    else if (ch === '{') braceBalance -= 1;
    else if (ch === '}') braceBalance += 1;
  }
  let end = rawMatch.length;
  while (end > 0) {
    const last = rawMatch[end - 1];
    if (last === '.' || last === ',' || last === ';' || last === '!') {
      end -= 1;
      continue;
    }
    if (last === ':') {
      const candidateEnd = end - 1;
      const firstColon = rawMatch.indexOf(':');
      if (
        firstColon >= 0 &&
        firstColon < candidateEnd - 1 &&
        !(
          candidateEnd >= 3 &&
          rawMatch[candidateEnd - 3] === ':' &&
          rawMatch[candidateEnd - 2] === '/' &&
          rawMatch[candidateEnd - 1] === '/'
        )
      ) {
        end = candidateEnd;
        continue;
      }
      break;
    }
    if (last === ')' && parenBalance > 0) {
      parenBalance -= 1;
      end -= 1;
      continue;
    }
    if (last === ']' && bracketBalance > 0) {
      bracketBalance -= 1;
      end -= 1;
      continue;
    }
    if (last === '}' && braceBalance > 0) {
      braceBalance -= 1;
      end -= 1;
      continue;
    }
    break;
  }
  return { url: rawMatch.slice(0, end), suffix: rawMatch.slice(end) };
}

function scrubInlineUrls(text: string): string {
  return text.replace(
    INLINE_URL_RE,
    (
      match,
      httpScheme: string | undefined,
      authorityScheme: string | undefined,
      blobScheme: string | undefined,
      dataScheme: string | undefined,
    ) => {
      const { url, suffix } = splitTrailingUrlPunct(match);
      const otherScheme = authorityScheme ?? blobScheme ?? dataScheme;
      if (otherScheme !== undefined) return `${otherScheme.toLowerCase()}:${suffix}`;
      const origin = sanitizeOrigin(url);
      return `${origin ?? `${(httpScheme ?? 'http').toLowerCase()}:`}${suffix}`;
    },
  );
}

/**
 * Strips Playwright `Call log:` traces, scrubs inline URLs to origin or scheme-only tokens,
 * flattens whitespace/newlines into a single line, and caps length to `MAX_MSG_CHARS`.
 */
export function formatLogMessage(raw: string): string {
  const withoutCallLog = stripPlaywrightCallLog(raw);
  const singleLine = scrubInlineUrls(withoutCallLog.replace(/\s+/g, ' ').trim());
  return truncate(singleLine, MAX_MSG_CHARS);
}

/** Classifies a `readPageIdentity` failure into a closed target-drop code. */
export function classifyTargetDropCode(
  error: unknown,
  isClosed: boolean,
): 'target_not_admitted' | 'target_closed' | 'page_identity_failed' {
  const message = errorMessage(error);
  if (NOT_ADMITTED_RE.test(message)) return 'target_not_admitted';
  if (isClosed || CLOSED_RE.test(message)) return 'target_closed';
  return 'page_identity_failed';
}

/**
 * Bounded deduplicator keyed by `(targetKey, code)` so repeated polling (e.g. consecutive
 * `list_pages` calls) emits at most one drop record per target and failure reason.
 */
export class LogDeduper {
  private readonly seen = new Set<string>();

  constructor(private readonly maxEntries = 256) {}

  shouldLog(targetKey: string, code: string): boolean {
    const composite = `${targetKey}\u0000${code}`;
    if (this.seen.has(composite)) return false;
    this.seen.add(composite);
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.values().next();
      if (oldest.done !== true) this.seen.delete(oldest.value);
    }
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}

/** Formats a flat JSONL line using an explicit allowlist (never emits `sessionId`/`session_id`). */
export function serializeWorkerLog(record: WorkerLogRecord, now: Date = new Date()): string {
  const entry: Record<string, string> = {
    ts: now.toISOString(),
    level: record.level,
    cat: record.cat,
  };
  if (record.code !== undefined && record.code !== '') entry['code'] = record.code;
  entry['msg'] = formatLogMessage(record.msg);
  if (record.tool !== undefined && record.tool !== '') entry['tool'] = record.tool;
  if (record.channel !== undefined) entry['channel'] = record.channel;
  if (record.pageId !== undefined && record.pageId !== '') entry['pageId'] = record.pageId;
  if (record.operationId !== undefined && record.operationId !== '') {
    entry['operationId'] = record.operationId;
  }
  const safeOrigin = sanitizeOrigin(record.origin);
  if (safeOrigin !== undefined) entry['origin'] = safeOrigin;
  return `${JSON.stringify(entry)}\n`;
}

function writeStderr(line: string): void {
  try {
    process.stderr.write(line);
  } catch {
    // Broken stderr pipe must never abort an MCP stdio call.
  }
}

/** Writes one flat JSONL record to `stderr` (or the installed test sink). */
export function workerLog(record: WorkerLogRecord, writer?: WorkerLogWriter): void {
  const line = serializeWorkerLog(record);
  (writer ?? customWriter ?? writeStderr)(line);
}
