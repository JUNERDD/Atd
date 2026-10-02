import { Type, type Static } from 'typebox';

/**
 * Upper bound on one quote's Markdown, the size of a conversation excerpt: a quote carries its
 * passage in the chip record (and so in the ledger and the run's material), not a reference.
 */
export const MAX_QUOTE_CHARS = 12000;

/** Upper bound on the messages one quote spans (a selection across several answers). */
export const MAX_QUOTE_PARTS = 16;

/**
 * Where a quote was taken from, so a client can scroll back to it: per message the selection
 * crossed, the transcript block id and the `[start, end)` range in that message's rendered text
 * (its text nodes in document order). The rendering is the client's, so only the client that
 * wrote the offsets reads them; the service ignores them.
 */
export const QuoteSourceSchema = Type.Array(
  Type.Object(
    {
      blockId: Type.String({ minLength: 1, maxLength: 256 }),
      start: Type.Integer({ minimum: 0 }),
      end: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  { minItems: 1, maxItems: MAX_QUOTE_PARTS },
);
export type QuoteSource = Static<typeof QuoteSourceSchema>;

/** Longest label a quote chip shows; the full passage is the chip's content. */
const LABEL_CHARS = 40;

/** A code fence line, which opens or closes code rather than saying anything itself. */
const FENCE = /^\s*(```|~~~)/;
/** Block markers at a line's start: blockquote, heading, list item, task box. */
const BLOCK_MARKERS = /^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;
/** Inline marks that only style prose: emphasis, strikethrough and code spans. */
const STYLE_MARKS = /\*+|~~|`+/g;

/**
 * The first line that says something, as plain text: prose without its Markdown marks (table pipes
 * read as separators), or a code line as written, since its symbols are its content.
 */
function firstLine(text: string): string {
  let code = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      code = !code;
      continue;
    }
    const plain = code
      ? line
      : line.replace(BLOCK_MARKERS, '').replace(STYLE_MARKS, '').replaceAll('|', ' ');
    if (plain.trim()) return plain;
  }
  return text;
}

/**
 * The name a quote chip shows wherever it appears (the composer, the sent message, the task
 * title): the passage's first line on one line, cut with an ellipsis. Clients and the service
 * derive it the same way, so the record stores only the passage.
 */
export function quoteLabel(text: string): string {
  const label = firstLine(text).replace(/\s+/g, ' ').trim();
  return label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1).trimEnd()}…` : label;
}
