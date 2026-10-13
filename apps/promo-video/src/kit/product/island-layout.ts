import type { Lang } from '../../copy.ts';
import { answerCardLayout, type AnswerCardSpec } from './answer-card.ts';
import { CAPSULE_HEIGHT, type IslandSize } from './island.ts';
import { footerWidth, ISLAND, keycapWidth, lineWidth, textButtonWidth } from './island-metrics.ts';
import { strings } from './strings.ts';

export { ISLAND, keycapWidth, lineWidth } from './island-metrics.ts';
export type { AnswerCardSpec } from './answer-card.ts';

/**
 * What the command island shows, and how big each content is (`IslandCapsules.swift`,
 * `IslandCard.swift`, `IslandChoreography.swift`), measured with the film's faces so the glass
 * shape can morph between the sizes before the browser lays anything out.
 */
export interface OptionsCardSpec {
  /**
   * The card's title: the command's name on a list or a sheet, the choice's label ("When done")
   * on a drill-down.
   */
  title: string;
  /**
   * A list's or a drill-down's values, in order, each 1–9 by its place; a sheet's option labels.
   * The "When done" values come from `outputChoice`.
   */
  values: readonly string[];
  /** The remembered value (the check, at the trailing edge beside its number); -1 for none. */
  current: number;
  /** The highlighted row at first, and where the keyboard moves it (`at`, on the island's clock). */
  selected: number;
  moves?: readonly { at: number; to: number }[];
  /**
   * `list` (default): a command whose only option is a choice, picked by ↑↓, 1–9 or ↩. `sheet`:
   * one row per option with what it shows now (`details`), changed by ←→ and run by ↩.
   * `drill`: a sheet's choice opened inside the card, picked by ↩, left by ⌘[, no Run button.
   */
  page?: 'list' | 'sheet' | 'drill' | undefined;
  /** A sheet's rows' trailing values (a choice's current value), by row; '' for none. */
  details?: readonly string[] | undefined;
  /** What a long list's filter field holds; it shows past six values. */
  filter?: string | undefined;
}

export type IslandContent =
  /** The shortcut is down: the name, the charge meter filling from `at`, and the hold hint. */
  | { kind: 'press'; command: string }
  /** Running: the grip, the spinner, the name shimmering, the values chip and the Esc hint. */
  | { kind: 'working'; command: string; summary?: string }
  | { kind: 'writing' }
  | { kind: 'done' }
  /** After the answer card's Copy: a check and "Copied". */
  | { kind: 'copied' }
  | { kind: 'card'; card: OptionsCardSpec }
  /** The answer card, where the answer could not be written. */
  | { kind: 'answer'; card: AnswerCardSpec };

/** Whether a content is a card (an 18 pt corner) rather than a capsule. */
export const isCard = (content: IslandContent) =>
  content.kind === 'card' || content.kind === 'answer';

/** A content and when the island turns to it. */
export interface IslandMoment {
  at: number;
  content: IslandContent;
}

const label = (text: string) => lineWidth(text, 13, 500);
const hint = (text: string) => lineWidth(text, 12, 400);
/** A hint's text around its keys: `Press`, the keys, `to cancel`, 4 pt apart. */
export function hintParts(template: string): [string, string] {
  const [before = '', after = ''] = template.split('{{keys}}');
  return [before.trim(), after.trim()];
}

function hintWidth(template: string, keys: readonly string[]): number {
  const parts = hintParts(template).filter(Boolean);
  const items = [...parts.map(hint), ...keys.map(keycapWidth)];
  return items.reduce((sum, width) => sum + width, 0) + 4 * (items.length - 1);
}

/** The footer's key hints on each page; every page but a drill-down also has Run. */
export function cardHints(lang: Lang, page: OptionsCardSpec['page']): [string, string][] {
  const k = strings[lang].command.keys;
  switch (page) {
    case 'sheet':
      return [
        ['↑↓', k.move],
        ['←→', k.change],
        ['␣', k.open],
        ['esc', k.close],
      ];
    case 'drill':
      return [
        ['↑↓', k.move],
        ['↩', k.pick],
        ['⌘[', k.back],
      ];
    case 'list':
    case undefined:
      return [
        ['↑↓', k.move],
        ['1–9', k.pick],
        ['esc', k.close],
      ];
  }
}

/** Whether a long list shows its filter field. */
export const hasFilter = (card: OptionsCardSpec) =>
  card.page !== 'sheet' && card.values.length > ISLAND.card.filterAfter;

/** The card's width: its widest row or footer within 300–420 pt. */
function cardWidth(lang: Lang, card: OptionsCardSpec): number {
  const t = strings[lang].command;
  const rows = card.values.map((value, index) => {
    const trailing =
      card.page === 'sheet'
        ? lineWidth(card.details?.[index] ?? '', 13, 400)
        : ISLAND.glyph + (index < 9 ? 8 + hint('9') : 0);
    return 8 + label(value) + 8 + trailing + 8;
  });
  const run = card.page === 'drill' ? 0 : textButtonWidth(t.run, keycapWidth('↩'));
  const footer = footerWidth(cardHints(lang, card.page), run);
  const ideal = Math.max(...rows, footer, lineWidth(card.title, 12, 600) + 16);
  return Math.min(
    Math.max(Math.ceil(ideal + ISLAND.card.padding * 2), ISLAND.card.min),
    ISLAND.card.max,
  );
}

/** The size `content` takes on the island. */
export function islandSize(lang: Lang, content: IslandContent): IslandSize {
  const t = strings[lang].command;
  const height = CAPSULE_HEIGHT;
  switch (content.kind) {
    case 'press':
      return {
        width: 12 + label(content.command) + 10 + ISLAND.meter + 10 + hint(t.holdHint) + 14,
        height,
      };
    case 'working': {
      const chip = content.summary
        ? 12 + 8 + Math.min(lineWidth(content.summary, 12, 500), ISLAND.chipMax) + 8
        : 0;
      const status = 2 + ISLAND.glyph + 6 + label(content.command) + chip + 12;
      const inner = status + hintWidth(t.escapeHint, ['Esc']) + 4;
      const { padding, gap, grip, control } = ISLAND;
      return { width: padding + grip + gap + inner + gap + control + padding, height };
    }
    case 'writing':
    case 'done':
    case 'copied':
      return { width: 12 + ISLAND.glyph + 8 + label(t[content.kind]) + 14, height };
    case 'card': {
      const { padding, header, row, gap, footer, maxRows, filter } = ISLAND.card;
      const rows = Math.min(Math.max(content.card.values.length, 1), maxRows);
      return {
        width: cardWidth(lang, content.card),
        height:
          padding * 2 +
          header +
          (hasFilter(content.card) ? filter + gap : 0) +
          rows * row +
          gap +
          footer,
      };
    }
    case 'answer': {
      const { width, height: cardHeight } = answerCardLayout(lang, content.card);
      return { width, height: cardHeight };
    }
  }
}

/** The highlighted row of a card at `t`. */
export function cardSelection(card: OptionsCardSpec, t: number): number {
  let selected = card.selected;
  for (const move of card.moves ?? []) if (t >= move.at) selected = move.to;
  return selected;
}
