import type { DiagLevel } from '../channel/diagnostics.ts';

/**
 * Pure, TypeBox-free diagnostic string and URL sanitization shared across all 4 extension
 * contexts (background, content script, panel, options). Uses module singletons and
 * `TextEncoder.encodeInto` to detach short strings without allocating large buffers for
 * multi-megabyte inputs or leaving lone surrogates.
 */

const MAX_DETACHED_UNITS = 256;
/** 256 UTF-16 code units take at most 768 UTF-8 bytes (BMP 3-byte chars, surrogate pairs 4/2). */
const SCRATCH_BYTES = 1024;
const MAX_ORIGIN_UNITS = 256;
const MAX_CAT_UNITS = 64;
const MAX_CODE_UNITS = 64;
const MAX_MSG_UNITS = 256;
const INLINE_URL_RE =
  /(?<![A-Za-z0-9+.-])(?:(https?):\/\/[^\s"'`<>]+|(wss?|file|chrome-extension|chrome):\/\/[^\s"'`<>]+|(blob):(?:(?:https?|file|chrome-extension):\/\/|null\/)[^\s"'`<>]+|(data):(?:[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+)?(?:;[A-Za-z0-9!#$&^_.+-]+(?:=[A-Za-z0-9!#$&^_.+-]+)?)*,[^\s"'`<>]*)/gi;

const sharedEncoder = new TextEncoder();
const sharedDecoder = new TextDecoder();
const sharedScratch = new Uint8Array(SCRATCH_BYTES);

/** UTF-8 byte length of a bounded string. */
export function utf8ByteLength(text: string): number {
  return sharedEncoder.encode(text).byteLength;
}

/** Detaches `<= maxUnits` UTF-16 code units into a fresh string without lone surrogates. */
export function detachText(input: string, maxUnits = MAX_DETACHED_UNITS): string {
  if (!input) return '';
  const limit = Math.min(Math.max(0, maxUnits), MAX_DETACHED_UNITS);
  if (limit === 0) return '';
  const { written } = sharedEncoder.encodeInto(input.slice(0, limit), sharedScratch);
  return sharedDecoder.decode(sharedScratch.subarray(0, written));
}

function collapseAndDetach(input: string, maxUnits: number): string {
  if (!input || maxUnits <= 0) return '';
  // Slice a bounded prefix before scanning so multi-megabyte strings never allocate heavily.
  const prefix = input.slice(0, Math.min(input.length, maxUnits * 4));
  const collapsed = collapseControlChars(prefix);
  return detachText(collapsed, maxUnits).trim();
}

/**
 * Collapses line breaks and control characters into single spaces and detaches to `<= maxUnits`
 * without URL scrubbing (for structured identifier tokens such as `extTs`, `cat`, `code`,
 * `runId`, `targetId`, and `cdpSession`).
 */
export function sanitizeToken(input: string, maxUnits: number): string {
  return collapseAndDetach(input, maxUnits);
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

function scrubInlineUrls(input: string): string {
  return input.replace(
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
 * Collapses line breaks and control characters into single spaces, scrubs inline URLs to origin
 * or scheme-only tokens, and detaches to `<= maxUnits`.
 */
export function sanitizeSingleLine(input: string, maxUnits: number): string {
  if (!input || maxUnits <= 0) return '';
  // Slice a bounded prefix before scanning so multi-megabyte strings never allocate heavily.
  const prefix = input.slice(0, Math.min(input.length, maxUnits * 4));
  const scrubbed = scrubInlineUrls(collapseControlChars(prefix));
  return detachText(scrubbed, maxUnits).trim();
}

function collapseControlChars(input: string): string {
  let out = '';
  let inControl = false;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029) {
      if (!inControl) {
        out += ' ';
        inControl = true;
      }
    } else {
      out += input[index] ?? '';
      inControl = false;
    }
  }
  return out.trim();
}

/**
 * Sanitizes a URL for diagnostics:
 * - `http:` / `https:` -> `new URL(url).origin` (no path/query/hash/userinfo), clipped to 256.
 * - Any other URL -> scheme-only (`chrome:`, `chrome-extension:`, `file:`, `about:`, `data:`,
 *   `blob:`, …) so local file paths, data URLs, and extension paths never leave the browser.
 */
export function sanitizeOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const value = parsed.origin && parsed.origin !== 'null' ? parsed.origin : parsed.protocol;
    const clipped = collapseAndDetach(value, MAX_ORIGIN_UNITS);
    return clipped || undefined;
  }
  const scheme = collapseAndDetach(parsed.protocol, MAX_ORIGIN_UNITS);
  return scheme || undefined;
}

/** Extracts a single-line bounded summary from an arbitrary thrown value. */
export function summarizeError(error: unknown, fallback = 'Unexpected error'): string {
  let raw = '';
  if (typeof error === 'string') {
    raw = error;
  } else if (error instanceof Error) {
    const message = error.message || '';
    const name = error.name || '';
    raw =
      name && name !== 'Error' && !message.startsWith(name)
        ? message
          ? `${name}: ${message}`
          : name
        : message || name;
  } else if (typeof error === 'object' && error !== null) {
    const message: unknown = Reflect.get(error, 'message');
    if (typeof message === 'string') raw = message;
  }
  return sanitizeSingleLine(raw, MAX_MSG_UNITS) || sanitizeSingleLine(fallback, MAX_MSG_UNITS);
}

export interface DiagEventPayload {
  type: 'diag.event';
  level: DiagLevel;
  cat: string;
  code?: string;
  msg: string;
}

/** Builds a schema-valid `diag.event` port message for content, panel, or options surfaces. */
export function buildDiagEvent(
  level: DiagLevel,
  cat: string,
  msg: string,
  code?: string,
): DiagEventPayload {
  const safeCat = sanitizeToken(cat, MAX_CAT_UNITS) || 'runtime';
  const safeCode = code === undefined ? undefined : sanitizeToken(code, MAX_CODE_UNITS);
  const safeMsg = sanitizeSingleLine(msg, MAX_MSG_UNITS) || safeCode || safeCat;
  return {
    type: 'diag.event',
    level,
    cat: safeCat,
    ...(safeCode ? { code: safeCode } : {}),
    msg: safeMsg,
  };
}
