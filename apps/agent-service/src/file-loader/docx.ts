import mammoth from 'mammoth';
import { counted, documentText, wordCount } from './document.js';
import { markCharts, placeCharts } from './docx-charts.js';
import { docxImages } from './docx-images.js';
import type { ExtractOutcome } from './jobs.js';
import { htmlToMarkdown } from './markdown.js';
import { ExtractOutputs } from './outputs.js';
import { Pictures } from './pictures.js';
import { readParts, storedZip } from './zip.js';

/** Mammoth's stored archive and image reads retain several copies of the media bytes. */
const MEDIA_BYTES = 128 * 1024 * 1024;

/**
 * A Word document as Markdown through mammoth: headings, lists and tables, and its charts as tables
 * of their data where they stand (docx-charts.ts). Mammoth reads inserted tracked changes as text
 * and skips deleted ones and comments; it never follows links to external files.
 */
export async function docxDocument(
  bytes: Uint8Array,
  label: string,
  out?: string,
): Promise<ExtractOutcome> {
  const outputs = new ExtractOutputs(out);
  const pictures = new Pictures(outputs, out !== undefined);
  const images = docxImages(pictures);
  const { parts, charts } = markCharts(
    readParts(
      bytes,
      pictures.budget(({ name }) => name.startsWith('word/media/'), MEDIA_BYTES),
    ),
  );
  const stored = storedZip(parts);
  const { value } = await mammoth.convertToHtml(
    { buffer: Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength) },
    { convertImage: images.convert, externalFileAccess: false },
  );
  const body = images.place(placeCharts(htmlToMarkdown(value), charts));
  const files = outputs.summary();
  return {
    status: 'text',
    ...(files ? { files } : {}),
    text: documentText({
      label,
      facts: [
        wordCount(body),
        ...(charts.size ? [counted(charts.size, 'chart')] : []),
        counted(pictures.count, 'image'),
      ],
      included: `text as Markdown with headings, lists, tables and charts as tables of their data; ${pictures.included}; comments are not included, and tracked changes appear accepted`,
      body,
    }),
  };
}
