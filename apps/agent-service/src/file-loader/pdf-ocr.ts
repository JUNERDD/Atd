import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { builtinSkillsTemplateDir } from '../builtins/manifest.js';
import { EXTRACT_TIMEOUT_MS } from './extract.js';
import { failureReason } from './jobs.js';
import { estimateTokens } from './material.js';
import { pageSection, type PageRecognition } from './pdf.js';
import { withTempFile, type RunProcess } from './process.js';

/**
 * The file-loader skill's OCR script as this build ships it, which a run with `bash` runs itself.
 * The service never runs the user's installed copy of the skill, which is theirs to change.
 */
const OCR_SCRIPT = path.join(builtinSkillsTemplateDir(), 'file-loader', 'scripts', 'ocr.js');

/** Recognizing one PDF's pages may take as long as one extraction (extract.ts). */
const RECOGNITION_MS = EXTRACT_TIMEOUT_MS;
const TIMED_OUT = `stopped after ${RECOGNITION_MS / 1000} seconds`;
/** Most bytes the script may print for one page. */
const OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Recognizes the text of a PDF's pages without a text layer ('' in `pages`) on this Mac with the
 * file-loader skill's OCR script, for a run that cannot run it itself (tasks/run-budget.ts
 * `recognize`). Pages are recognized in order while the document's text before them stays within
 * `tokens` estimated tokens, the most one file's material holds, and for `RECOGNITION_MS` in all.
 * The pages become text rather than rendered images, which would cost several times their text
 * with every later request and reach only models that take images. Each page is a call of its own,
 * so the limits stop between pages and the script's output needs no splitting. Undefined when no
 * such page starts within `tokens`; a failure ends recognition with the pages recognized so far.
 * Rejects only with `signal`'s reason once it aborts.
 */
export async function recognizePages(
  bytes: Uint8Array,
  pages: readonly (string | null)[],
  tokens: number,
  run: RunProcess,
  signal?: AbortSignal,
): Promise<PageRecognition | undefined> {
  // The text before the first page to recognize, which needs no temporary copy of the file.
  let start = 0;
  let used = 0;
  while (start < pages.length && pages[start] !== '' && used < tokens) {
    used += estimateTokens(pageSection(start + 1, pages[start] ?? null));
    start += 1;
  }
  if (start === pages.length || used >= tokens) return undefined;
  const recognized = new Map<number, string>();
  const deadline = performance.now() + RECOGNITION_MS;
  try {
    return await withTempFile(bytes, 'pdf', async (file) => {
      for (let index = start; index < pages.length && used < tokens; index += 1) {
        const text = pages[index] ?? null;
        let page: string | undefined;
        if (text === '') {
          if (performance.now() >= deadline) return { pages: recognized, stopped: TIMED_OUT };
          // execFile takes whole milliseconds.
          const left = Math.ceil(deadline - performance.now());
          page = (await recognizePage(file, index + 1, run, left, signal)) ?? undefined;
          if (page !== undefined) recognized.set(index + 1, page);
        }
        used += estimateTokens(pageSection(index + 1, text, page));
      }
      return { pages: recognized };
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    // A call outliving the deadline is killed then (process.ts).
    const stopped = performance.now() >= deadline ? TIMED_OUT : `failed (${failureReason(error)})`;
    return { pages: recognized, stopped };
  }
}

/**
 * The text the script recognizes on page `page` of the PDF at `file`: '' when it found none, null
 * when recognition failed on that page. The script prints the page's `--- Page N (OCR) ---` line,
 * then its text, `[No text recognized]` or `[Recognition failed]`.
 */
async function recognizePage(
  file: string,
  page: number,
  run: RunProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const range = String(page);
  const { stdout } = await run(
    '/usr/bin/osascript',
    ['-l', 'JavaScript', OCR_SCRIPT, file, range, range],
    { timeoutMs, maxBuffer: OUTPUT_BYTES, ...(signal ? { signal } : {}) },
  );
  const [marker, ...lines] = stdout.toString('utf8').trimEnd().split('\n');
  if (marker !== `--- Page ${page} (OCR) ---`)
    throw new Error('the OCR script sent an unexpected reply');
  const text = lines.join('\n');
  if (text === '[Recognition failed]') return null;
  return text === '[No text recognized]' ? '' : text;
}
