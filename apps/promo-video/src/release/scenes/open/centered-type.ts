/**
 * A line typed in a centered paragraph, as a model: what is on the line at `t`, and where the line
 * sits. The caret starts at the anchor and the line grows both ways from it, as centered text does
 * in an editor, except that the line glides to its new center after each keystroke instead of
 * jumping half a glyph: every change of width springs in (`FOLLOW`). Widths are measured in the
 * loaded faces (`textWidthEm`), so the finished line ends centered on the anchor.
 *
 * Used by the open (the rough line rewritten in place, the title line) and the finale (the lockup,
 * the tagline, the address). The scene owns the anchor; the model works in px from it.
 */
import { textWidthEm } from '../../../kit/world/measure.ts';
import { graphemes } from '../../../kit/world/text-units.ts';
import { clamp01, easeInOut } from '../../../motion/ease.ts';
import { springAt, type Spring } from '../../../motion/spring.ts';
import { CARET_HOLD, isTyping, typedAt } from '../../world/typing.ts';

/** How a line is set: font size in px, weight, and tracking in em (Inter or Noto Sans SC). */
export interface TypeSet {
  size: number;
  weight: number;
  tracking: number;
}

/** A typed text and the time each of its graphemes appears (from `typeTimes`, or explicit). */
export interface Stream {
  text: string;
  times: readonly number[];
}

export interface CenteredTypeInput {
  t: number;
  set: TypeSet;
  text: Stream;
  /** A drag selection across the whole typed line, from `at` over `duration`. */
  select?: { at: number; duration: number };
  /** At `at` the line (or its selection) is deleted and `replace` typed in its place. */
  replace?: Stream & { at: number };
  /** Something set before the text as its first "glyph" (the finale's mark): px wide incl. gap. */
  lead?: { at: number; width: number };
}

export type RunKind = 'typed' | 'selected';

export interface Run {
  kind: RunKind;
  text: string;
}

export interface CenteredTypeState {
  runs: Run[];
  leadShown: boolean;
  /** The caret is held solid (a keystroke just landed). */
  typing: boolean;
  /** A selection is showing, so the caret is hidden, as an editor hides it. */
  selecting: boolean;
  /** The line's left edge, in px from the anchor (the glide: negative half the sprung width). */
  shift: number;
  /** What is on the line now, in px (the caret sits at `shift + width`). */
  width: number;
}

/** The glide after each change of width: quick, without overshoot. */
const FOLLOW: Spring = { response: 0.26, damping: 1 };

/** A text's advance width in px, set in `set`. */
export function widthOf(text: string, set: TypeSet): number {
  return text === '' ? 0 : textWidthEm(text, set.weight, set.tracking) * set.size;
}

/** Each keystroke's change of width (and a rewrite's, as one), as a time and a px delta. */
function changes(input: CenteredTypeInput): { at: number; delta: number }[] {
  const { set, text, replace, lead } = input;
  const out: { at: number; delta: number }[] = [];
  if (lead) out.push({ at: lead.at, delta: lead.width });
  const stream = (s: Stream) => {
    const units = graphemes(s.text);
    let before = 0;
    s.times.forEach((at, index) => {
      const after = widthOf(units.slice(0, index + 1).join(''), set);
      out.push({ at, delta: after - before });
      before = after;
    });
  };
  stream(text);
  // A rewrite lands as one edit (the app writes the whole answer back at once), so the line glides
  // once from the old width to the new instead of contracting on the deletion and re-expanding.
  if (replace) {
    out.push({ at: replace.at, delta: widthOf(replace.text, set) - widthOf(text.text, set) });
  }
  return out;
}

/** The line at `t`. */
export function centeredTypeAt(input: CenteredTypeInput): CenteredTypeState {
  const { t, set, text, select, replace, lead } = input;
  const leadShown = lead !== undefined && t >= lead.at;
  const leadWidth = leadShown ? lead.width : 0;
  const leadTyping = lead !== undefined && t >= lead.at && t <= lead.at + CARET_HOLD;
  const sprung = changes(input).reduce(
    (sum, { at, delta }) => sum + delta * springAt(t, at, FOLLOW),
    0,
  );
  const shift = -sprung / 2;

  if (replace && t >= replace.at) {
    const shown = graphemes(replace.text).slice(0, typedAt(replace.times, t)).join('');
    return {
      runs: [{ kind: 'typed', text: shown }],
      leadShown,
      typing: isTyping(replace.times, t) || t < (replace.times[0] ?? replace.at),
      selecting: false,
      shift,
      width: leadWidth + widthOf(shown, set),
    };
  }

  const units = graphemes(text.text);
  const count = typedAt(text.times, t);
  const typed = units.slice(0, count).join('');
  const width = leadWidth + widthOf(typed, set);
  if (select && t >= select.at) {
    // A drag selection snaps from character to character, as an editor's does.
    const end = Math.round(easeInOut(clamp01((t - select.at) / select.duration)) * count);
    const runs: Run[] = [
      { kind: 'selected', text: units.slice(0, end).join('') },
      { kind: 'typed', text: units.slice(end, count).join('') },
    ];
    return { runs, leadShown, typing: false, selecting: true, shift, width };
  }
  return {
    runs: [{ kind: 'typed', text: typed }],
    leadShown,
    typing: isTyping(text.times, t) || leadTyping,
    selecting: false,
    shift,
    width,
  };
}

/**
 * Where each keystroke lands, in px from the anchor, at the moment it lands: the caret's position
 * just after it, for a ripple in the dots under the caret.
 */
export function keystrokeOffsets(input: CenteredTypeInput): { at: number; x: number }[] {
  const times = [...input.text.times, ...(input.replace?.times ?? [])];
  return times.map((at) => {
    const state = centeredTypeAt({ ...input, t: at });
    return { at, x: state.shift + state.width };
  });
}
