import mammoth from 'mammoth';
import { documentText, wordCount } from './document.js';
import type { ExtractOutcome } from './jobs.js';
import { htmlToMarkdown } from './markdown.js';
import { storedCopy } from './zip.js';

/** Images become `<img>` without data, so turndown keeps only their alt text. */
const dropImages = mammoth.images.imgElement(() => Promise.resolve({ src: '' }));

/**
 * A Word document as Markdown through mammoth: headings, lists and tables. Mammoth reads inserted
 * tracked changes as text and skips deleted ones and comments; it never follows links to external
 * files.
 */
export async function docxDocument(bytes: Uint8Array, label: string): Promise<ExtractOutcome> {
  const stored = storedCopy(bytes);
  const { value } = await mammoth.convertToHtml(
    { buffer: Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength) },
    { convertImage: dropImages, externalFileAccess: false },
  );
  const body = htmlToMarkdown(value);
  return {
    status: 'text',
    text: documentText({
      label,
      facts: [wordCount(body)],
      included:
        'text as Markdown with headings, lists and tables; images and comments are not included, and tracked changes appear accepted',
      body,
    }),
  };
}
