import { isUtf8 } from 'node:buffer';
import { analyse, detect } from 'chardet';

/** Bytes sampled to judge whether a file is text and which encoding it uses. */
export const TEXT_SAMPLE_BYTES = 64 * 1024;

/** Share of control characters above which a sample counts as binary. */
const BINARY_CONTROL_SHARE = 0.1;
/** Share of NUL bytes UTF-8 text may carry (a log cut short by a crash); others take none. */
const UTF8_NUL_SHARE = 0.001;
/**
 * Valid multi-byte characters per invalid byte from which bytes that are not valid UTF-8 still
 * decode as UTF-8: text in a legacy encoding has few or none of them.
 */
const LOSSY_UTF8_RATIO = 20;

const ESC = 0x1b;

/**
 * A text file's content: `utf8` when its bytes already are UTF-8 text without a BOM, so a reader
 * can pass them on as they are; otherwise the decoded text.
 */
export type DecodedText = { utf8: true } | { utf8: false; text: string };

/**
 * Decodes a file of no known binary format: by its BOM, then as BOM-less UTF-16 by its zero
 * bytes, then as UTF-8, then in the encoding chardet guesses from a sample. UTF-16 comes before
 * UTF-8 because its zero bytes are valid UTF-8 too. UTF-8 with a few invalid bytes (a stray
 * Latin-1 byte, a character cut in half) decodes as UTF-8 with U+FFFD in their place. Null when
 * the bytes are binary: too many control characters, or NUL bytes beyond a few in UTF-8 text.
 */
export function decodeText(bytes: Uint8Array): DecodedText | null {
  const bom = bomEncoding(bytes);
  if (bom === 'binary') return null;
  // TextDecoder drops a BOM that matches its encoding.
  if (bom) return { utf8: false, text: new TextDecoder(bom).decode(bytes) };
  const sample = bytes.subarray(0, TEXT_SAMPLE_BYTES);
  const utf16 = utf16Pattern(sample);
  if (utf16) {
    const text = new TextDecoder(utf16).decode(bytes);
    return controlShare(text.slice(0, TEXT_SAMPLE_BYTES / 2)) > BINARY_CONTROL_SHARE
      ? null
      : { utf8: false, text };
  }
  if (looksBinary(sample)) return null;
  if (isUtf8(bytes)) {
    // Seven-bit ISO-2022 text is valid UTF-8 too; its escape sequences give it away.
    const guess = sample.includes(ESC) ? detect(sample) : null;
    if (!guess?.startsWith('ISO-2022')) return { utf8: true };
    return { utf8: false, text: decodeAs(guess, bytes) };
  }
  if (mostlyUtf8(bytes)) return { utf8: false, text: new TextDecoder().decode(bytes) };
  if (sample.includes(0)) return null;
  return { utf8: false, text: decodeAs(guessEncoding(sample), bytes) };
}

/**
 * chardet's most confident encoding that decodes the sample without an error: on a short sample
 * it can rank an encoding the bytes cannot be first (EUC-JP over GB18030). A sequence the sample
 * cuts at its end does not count against an encoding.
 */
function guessEncoding(sample: Uint8Array): string {
  const names = analyse(sample).map((match) => match.name);
  const strict = names.find((name) => {
    try {
      new TextDecoder(name, { fatal: true }).decode(sample, { stream: true });
      return true;
    } catch {
      return false;
    }
  });
  return strict ?? names[0] ?? 'windows-1252';
}

/**
 * Whether the start of a file reads as valid UTF-8 text: no binary signs, and valid UTF-8 once a
 * character the sample cuts in half is set aside.
 */
export function startsAsUtf8Text(head: Uint8Array): boolean {
  if (bomEncoding(head) !== undefined || utf16Pattern(head) || looksBinary(head)) return false;
  return isUtf8(head.subarray(0, completeUtf8Length(head)));
}

/**
 * Whether bytes that are not valid UTF-8 are UTF-8 text with a few invalid bytes: at least
 * `LOSSY_UTF8_RATIO` valid multi-byte characters for each invalid byte.
 */
function mostlyUtf8(bytes: Uint8Array): boolean {
  let valid = 0;
  let invalid = 0;
  for (let index = 0; index < bytes.length;) {
    if ((bytes[index] ?? 0) < 0x80) {
      index += 1;
      continue;
    }
    const length = sequenceLength(bytes, index);
    if (length) valid += 1;
    else invalid += 1;
    index += length || 1;
  }
  return invalid * LOSSY_UTF8_RATIO <= valid;
}

/** The length of the valid UTF-8 sequence that a non-ASCII byte at `index` starts, 0 if none. */
function sequenceLength(bytes: Uint8Array, index: number): number {
  const lead = bytes[index] ?? 0;
  let length = 4;
  let low = 0x80;
  let high = 0xbf;
  if (lead >= 0xc2 && lead <= 0xdf) length = 2;
  else if (lead >= 0xe0 && lead <= 0xef) length = 3;
  else if (lead < 0xf0 || lead > 0xf4) return 0;
  // The second byte's range excludes overlong forms, surrogates and code points past U+10FFFF.
  if (lead === 0xe0) low = 0xa0;
  else if (lead === 0xed) high = 0x9f;
  else if (lead === 0xf0) low = 0x90;
  else if (lead === 0xf4) high = 0x8f;
  const second = bytes[index + 1] ?? 0;
  if (second < low || second > high) return 0;
  for (let offset = 2; offset < length; offset += 1) {
    const next = bytes[index + offset] ?? 0;
    if (next < 0x80 || next > 0xbf) return 0;
  }
  return length;
}

/** The encoding a BOM names; `binary` for UTF-32, which TextDecoder cannot decode. */
function bomEncoding(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' | 'binary' | undefined {
  const [first, second, third, fourth] = bytes;
  if (first === 0xef && second === 0xbb && third === 0xbf) return 'utf-8';
  if (first === 0xff && second === 0xfe) return third === 0 && fourth === 0 ? 'binary' : 'utf-16le';
  if (first === 0xfe && second === 0xff) return 'utf-16be';
  if (first === 0 && second === 0 && third === 0xfe && fourth === 0xff) return 'binary';
  return undefined;
}

/**
 * BOM-less UTF-16 by its zero bytes: text that is mostly Latin script has a zero in every other
 * byte, on the odd side for little-endian and the even side for big-endian.
 */
function utf16Pattern(sample: Uint8Array): 'utf-16le' | 'utf-16be' | undefined {
  const pairs = Math.floor(sample.length / 2);
  if (pairs < 2) return undefined;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index + 1 < sample.length; index += 2) {
    if (sample[index] === 0) evenZeros += 1;
    if (sample[index + 1] === 0) oddZeros += 1;
  }
  if (oddZeros > pairs * 0.3 && evenZeros < pairs * 0.02) return 'utf-16le';
  if (evenZeros > pairs * 0.3 && oddZeros < pairs * 0.02) return 'utf-16be';
  return undefined;
}

/**
 * More NUL bytes than UTF-8 text may carry, or more control bytes than text carries (tab, line
 * breaks, form feed and ESC aside).
 */
function looksBinary(sample: Uint8Array): boolean {
  let nuls = 0;
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) nuls += 1;
    if (isControl(byte)) controls += 1;
  }
  return nuls > sample.length * UTF8_NUL_SHARE || controls > sample.length * BINARY_CONTROL_SHARE;
}

function controlShare(text: string): number {
  if (!text) return 0;
  let controls = 0;
  for (let index = 0; index < text.length; index += 1)
    if (isControl(text.charCodeAt(index))) controls += 1;
  return controls / text.length;
}

function isControl(code: number): boolean {
  return (
    (code < 0x20 &&
      code !== 0x09 &&
      code !== 0x0a &&
      code !== 0x0c &&
      code !== 0x0d &&
      code !== 0x0b &&
      code !== ESC) ||
    code === 0x7f
  );
}

/** Decodes in `label`, or in Windows-1252 when Node has no decoder for it (chardet knows more). */
function decodeAs(label: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The length of `bytes` without a trailing UTF-8 sequence the sample cut short. */
function completeUtf8Length(bytes: Uint8Array): number {
  let start = bytes.length;
  // Step back over continuation bytes (10xxxxxx) to the start of the last sequence.
  while (start > 0 && bytes.length - start < 3 && ((bytes[start - 1] ?? 0) & 0xc0) === 0x80)
    start -= 1;
  const lead = bytes[start - 1];
  if (lead === undefined || lead < 0xc0) return bytes.length;
  const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
  return bytes.length - (start - 1) < needed ? start - 1 : bytes.length;
}
