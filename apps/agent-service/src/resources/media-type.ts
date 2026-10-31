import { attachmentMime, UNKNOWN_FILE_MIME } from '@atd/agent-contracts';
import { formatHint, formatOf } from '../file-loader/formats.js';
import { detect } from '../file-loader/sniff.js';

/** A client's own type the store keeps for text: `text/plain`, `text/markdown` and the like. */
const TEXT_MIME = /^text\/[\w.+-]+$/i;
/** How much of a file's start must be free of NUL bytes for a client's text type to stand. */
const TEXT_PROBE_BYTES = 4096;

/**
 * The media type a shared resource is stored with, which clients show it by (image chips, the
 * vision notice) and the loader starts from. The content decides first: the format its bytes
 * show (file-loader/sniff.ts), named as the loader names it, so an extensionless PNG is an image
 * and a misnamed JPEG a JPEG. Content without a binary signature reads as text, which says nothing
 * of its format, so the name's extension decides; `claimed`, the type the caller named, counts
 * only when the name settles nothing, it is a text type and the bytes look like text (a pasted
 * text upload named without an extension).
 */
export function storedMime(bytes: Uint8Array, name: string, claimed: string): string {
  const found = detect(bytes, formatHint(name));
  if (found.route !== 'text') {
    const { mime } = formatOf(found.id);
    if (mime !== UNKNOWN_FILE_MIME) return mime;
  }
  const named = attachmentMime(name);
  if (named !== UNKNOWN_FILE_MIME || found.route !== 'text') return named;
  const textual = !bytes.subarray(0, TEXT_PROBE_BYTES).includes(0);
  return textual && TEXT_MIME.test(claimed) ? claimed.toLowerCase() : named;
}
