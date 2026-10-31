import { randomBytes } from 'node:crypto';
import mammoth from 'mammoth';
import type { Pictures } from './pictures.js';

/**
 * Mammoth's sequential callbacks preserve document order. Nonce alt markers survive Markdown,
 * including pictures without alt text, without changing the shared HTML image conversion rule.
 */
export function docxImages(pictures: Pictures): {
  convert: ReturnType<typeof mammoth.images.imgElement>;
  place: (markdown: string) => string;
} {
  const nonce = randomBytes(6).toString('hex');
  const images = new Map<string, string>();
  let outputFailure: { error: unknown } | undefined;
  const convert = mammoth.images.imgElement(async (image) => {
    const alt = 'altText' in image && typeof image.altText === 'string' ? image.altText : '';
    let bytes: Uint8Array | undefined;
    if (pictures.saving) {
      try {
        bytes = await image.readAsBuffer();
      } catch {
        // Mammoth drops images whose converter throws, so retain unreadable images ourselves.
      }
    }
    const marker = `ATDIMAGE${nonce}N${images.size + 1}Z`;
    try {
      images.set(marker, pictures.place(bytes, alt, 'Document', image.contentType ?? ''));
    } catch (error) {
      // Mammoth recovers converter errors; output I/O errors must instead reach the store.
      outputFailure ??= { error };
    }
    return { src: '', alt: marker };
  });
  return {
    convert,
    place(markdown: string): string {
      if (outputFailure) throw outputFailure.error;
      return markdown.replace(
        new RegExp(`\\[Image: (ATDIMAGE${nonce}N\\d+Z)\\]`, 'g'),
        (original, marker: string) => images.get(marker) ?? original,
      );
    },
  };
}
