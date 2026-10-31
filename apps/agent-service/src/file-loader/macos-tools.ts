import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withTempFile, type ProcessOptions, type RunProcess } from './process.js';
import type { TextutilFormat } from './sniff.js';

/** How long one macOS tool may run before it is killed. */
const TOOL_TIMEOUT_MS = 30_000;
const MIB = 1024 * 1024;

function options(maxBuffer: number, signal?: AbortSignal): ProcessOptions {
  return { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer, ...(signal ? { signal } : {}) };
}

/**
 * A document as HTML through macOS textutil. textutil is forced to read `format`, so a file is
 * never opened as a web page or web archive, whose resources WebKit could fetch.
 */
export function textutilHtml(
  bytes: Uint8Array,
  format: TextutilFormat,
  run: RunProcess,
  signal?: AbortSignal,
): Promise<string> {
  return withTempFile(bytes, format === 'wordml' ? 'xml' : format, async (file) => {
    const { stdout, stderr } = await run(
      '/usr/bin/textutil',
      ['-convert', 'html', '-noload', '-nostore', '-stdout', '-format', format, '--', file],
      options(64 * MIB, signal),
    );
    const html = stdout.toString('utf8');
    // textutil exits 0 when it cannot read a file too, saying so only on stderr.
    if (!html.trim()) throw new Error(toolMessage(stderr, file) || 'macOS could not read it');
    return html;
  });
}

/**
 * An image as JPEG through macOS sips (ImageIO reads HEIC, HEIF, TIFF and AVIF) at its own size,
 * so the dimensions a later scaling reports are the original's.
 */
export function sipsJpeg(
  bytes: Uint8Array,
  extension: string,
  run: RunProcess,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return withTempFile(bytes, extension, async (file, dir) => {
    const out = path.join(dir, 'converted.jpg');
    await run('/usr/bin/sips', ['-s', 'format', 'jpeg', file, '--out', out], options(MIB, signal));
    return new Uint8Array(
      await readFile(out).catch(() => {
        throw new Error('macOS could not convert it');
      }),
    );
  });
}

/**
 * The plain text macOS Spotlight's importers read from a file (`kMDItemTextContent`): the only
 * reader of Pages and Keynote documents on a Mac without their apps' help. `mdimport -t` imports
 * into nothing; the file gets its extension so Spotlight picks the right importer.
 */
export function spotlightText(
  bytes: Uint8Array,
  extension: string,
  run: RunProcess,
  signal?: AbortSignal,
): Promise<string> {
  return withTempFile(bytes, extension, async (file, dir) => {
    const plist = path.join(dir, 'import.plist');
    await run('/usr/bin/mdimport', ['-t', '-o', plist, file], options(MIB, signal));
    const { stdout } = await run(
      '/usr/bin/plutil',
      ['-extract', 'kMDItemTextContent', 'raw', '-o', '-', '--', plist],
      options(64 * MIB, signal),
    ).catch((error: unknown) => {
      if (signal?.aborted) throw error;
      throw new Error('macOS found no text in it');
    });
    return stdout.toString('utf8');
  });
}

/** A tool's first stderr line without the temporary file it names. */
function toolMessage(stderr: Buffer, file: string): string {
  const line = stderr.toString('utf8').trim().split('\n', 1)[0] ?? '';
  return line
    .replaceAll(file, '')
    .replace(/^Error reading\s*\.?\s*/i, '')
    .trim();
}
