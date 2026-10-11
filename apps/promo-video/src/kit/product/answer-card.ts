import type { Lang } from '../../copy.ts';
import type { IslandSize } from './island.ts';
import { footerWidth, ISLAND, lineWidth, textButtonWidth } from './island-metrics.ts';
import { strings } from './strings.ts';
import { graphemes } from './text.ts';

/**
 * The answer card the island grows into where a run's answer could not be written
 * (`IslandAnswerCard.swift`, `AnswerCardMetrics.swift`): the options card's corner, 6 pt padding,
 * 28 pt title row and 32 pt footer around an optional note (12 pt, up to two lines) and the answer
 * (13 pt), 4 pt above and below it. As wide as its widest part within 300–420 pt, as tall as its
 * note and answer wrap to at that width, up to 400 pt, past which the answer scrolls behind a
 * 16 pt fade. Measured: a short answer 329 × 96, with a one-line note 329 × 113, a long one
 * 420 × 400.
 */
export interface AnswerCardSpec {
  /** The command's name: the card's title. */
  command: string;
  /** The answer, as the page gave it (user data, untranslated). */
  answer: string;
  /** Why nothing was written (`command.unwritten.*`), when the page said. */
  note?: string | undefined;
}

export const ANSWER = {
  /** The answer's and the note's line heights, and the gap under the note. */
  answerLine: 16,
  noteLine: 15,
  noteGap: 2,
  noteLines: 2,
  /** How far the fade reaches into the answer from an edge with more past it. */
  fade: 16,
  /** The rows' inset (`rowPadding`) either side of the title, the note and the answer. */
  inset: 8,
} as const;

const CJK = /[⺀-鿿豈-﫿＀-￯]/u;

/** How many lines `text` wraps to at `width` points, breaking at spaces and between CJK glyphs. */
export function wrappedLines(text: string, size: number, weight: number, width: number): number {
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    const tokens = paragraph
      .split(/(\s+)/u)
      .flatMap((token) => (CJK.test(token) ? graphemes(token) : [token]));
    let line = '';
    let count = 1;
    for (const token of tokens) {
      const next = line + token;
      if (line.trim() && lineWidth(next.trimEnd(), size, weight) > width) {
        count += 1;
        line = token.trimStart();
      } else {
        line = next;
      }
    }
    lines += count;
  }
  return lines;
}

/** Everything but the answer: the padding, the title row, the note, the gaps and the footer. */
function chrome(note: number): number {
  const { padding, header, gap, footer } = ISLAND.card;
  return padding * 2 + header + (note > 0 ? note + ANSWER.noteGap : 0) + gap * 2 + footer;
}

/** The card's rest size, and how tall its answer and note are at that width. */
export function answerCardLayout(
  lang: Lang,
  card: AnswerCardSpec,
): IslandSize & { answer: number; note: number; room: number } {
  const t = strings[lang].command.answer;
  const { padding, min, max, maxHeight } = ISLAND.card;
  const inset = ANSWER.inset * 2;
  const paragraphs = card.answer.split('\n').map((line) => lineWidth(line, 13, 400));
  const buttons = textButtonWidth(t.openInAtd) + ISLAND.gap + textButtonWidth(t.copy);
  const ideal = Math.max(
    ANSWER.inset + lineWidth(card.command, 12, 600) + 16 + ISLAND.control,
    card.note ? inset + lineWidth(card.note, 12, 400) : 0,
    inset + Math.max(...paragraphs),
    footerWidth(
      [
        ['⌘C', t.copy],
        ['esc', t.close],
      ],
      buttons,
    ),
  );
  const width = Math.min(Math.max(Math.ceil(ideal + padding * 2), min), max);
  const inner = width - padding * 2 - inset;
  const noteLines = card.note
    ? Math.min(wrappedLines(card.note, 12, 400, inner), ANSWER.noteLines)
    : 0;
  const note = noteLines * ANSWER.noteLine;
  const answer = wrappedLines(card.answer, 13, 400, inner) * ANSWER.answerLine;
  const height = Math.min(Math.ceil(chrome(note) + answer), maxHeight);
  return { width, height, answer, note, room: maxHeight - chrome(note) };
}
