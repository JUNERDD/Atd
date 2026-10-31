import { counted, documentText } from './document.js';
import type { ExtractOutcome } from './jobs.js';
import type { ExtractedFiles } from './outputs.js';

/** One slide's text lines and speaker-note lines, in reading order. */
export interface SlideText {
  lines: string[];
  notes: string[];
}

/**
 * What a deck's header says beside its slide count (further counts, and what its text holds), and
 * the files its extraction wrote.
 */
export interface DeckParts {
  facts: readonly string[];
  included: string;
  files?: ExtractedFiles | undefined;
}

/**
 * A deck as `## Slide N` sections: the slide's text (`[No text]` when it has none), then `Notes:`
 * and its speaker notes when it has any. pptx.ts and odp.ts read the slides.
 */
export function slidesDocument(
  label: string,
  slides: readonly SlideText[],
  { facts, included, files }: DeckParts,
): ExtractOutcome {
  const sections = slides.map(({ lines, notes }, index) =>
    [
      `## Slide ${index + 1}`,
      ...(lines.length ? lines : ['[No text]']),
      ...(notes.length ? ['', 'Notes:', ...notes] : []),
    ].join('\n'),
  );
  return {
    status: 'text',
    ...(files ? { files } : {}),
    text: documentText({
      label,
      facts: [counted(slides.length, 'slide'), ...facts],
      included,
      body: sections.join('\n\n'),
    }),
  };
}

/** A table row as a pipe row, `|` in cells escaped. */
export function tableRow(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`;
}
