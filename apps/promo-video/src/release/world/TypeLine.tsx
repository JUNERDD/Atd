import type { Lang } from '../../copy.ts';
import { graphemes, langTag } from '../../kit/world/text-units.ts';
import { clamp01, easeInOut } from '../../motion/ease.ts';
import { Caret } from './Caret.tsx';
import { isTyping, typeTimes, typedAt, type TypePace } from './typing.ts';
import './release.css';
import './type-line.css';

export type TypeSize = 'hero' | 'statement' | 'line' | 'label' | 'small';

/** A drag selection across graphemes `from`–`to` (exclusive; default the whole line). */
export interface SelectSweep {
  from?: number;
  to?: number;
  /** When the drag starts and how long it takes to reach `to`. */
  at: number;
  duration: number;
  /** When the selection clears (default: it stays until a `replace`). */
  until?: number;
}

/** Retyping in place: at `at` the selection (or the whole line) is deleted and `text` typed. */
export interface Replace {
  text: string;
  at: number;
  pace?: TypePace;
  seed?: number;
}

interface TypeLineProps {
  t: number;
  lang: Lang;
  text: string;
  /** When the first character is typed. */
  at: number;
  /** Characters per second, `shipped` (the app's write-back pace) or `instant` (default 16/s). */
  pace?: TypePace;
  /** Varies a person's rhythm between lines (see `typeTimes`). */
  seed?: number;
  size?: TypeSize;
  tone?: 'fg' | 'muted';
  /** `display` sets it heavy and tight; `text` at a reading weight (default `display`). */
  weight?: 'display' | 'text';
  /** When the caret shows (default from `at` on); `false` hides it. */
  caret?: { from?: number; until?: number } | false;
  select?: SelectSweep;
  replace?: Replace;
}

type RunKind = 'typed' | 'selected' | 'pending';

interface Run {
  kind: RunKind;
  text: string;
}

/** Consecutive graphemes of one kind, as one span each. */
function runsOf(units: readonly string[], kindOf: (index: number) => RunKind): Run[] {
  const runs: Run[] = [];
  units.forEach((unit, index) => {
    const kind = kindOf(index);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += unit;
    else runs.push({ kind, text: unit });
  });
  return runs;
}

interface Live {
  before: Run[];
  after: Run[];
  caret: boolean;
  typing: boolean;
}

/** The line as it stands at `t`: its runs on either side of the caret, and the caret's state. */
function liveLine(props: TypeLineProps): Live & { final: string } {
  const { t, text, at, pace, seed = 0, select, replace } = props;
  const units = graphemes(text);
  const from = Math.max(0, Math.min(units.length, select?.from ?? 0));
  const to = Math.max(from, Math.min(units.length, select?.to ?? units.length));
  const caretShown = (start: number) => {
    if (props.caret === false) return false;
    return t >= (props.caret?.from ?? start) && t < (props.caret?.until ?? Infinity);
  };

  const prefix = units.slice(0, from).join('');
  const suffix = units.slice(to).join('');
  const final = replace ? `${prefix}${replace.text}${suffix}` : text;

  if (replace && t >= replace.at) {
    const added = graphemes(replace.text);
    const times = typeTimes(replace.text, replace.at, replace.pace ?? pace, replace.seed ?? seed);
    const count = typedAt(times, t);
    return {
      final,
      before: [{ kind: 'typed', text: prefix + added.slice(0, count).join('') }],
      // An editor reflows as it types: what follows the insertion moves with it.
      after: [{ kind: 'typed', text: suffix }],
      caret: caretShown(at),
      typing: isTyping(times, t),
    };
  }

  const times = typeTimes(text, at, pace, seed);
  const count = typedAt(times, t);
  const selecting = select !== undefined && t >= select.at && t < (select.until ?? Infinity);
  if (selecting) {
    // A drag selection snaps from character to character, as an editor's does.
    const reach = easeInOut(clamp01((t - select.at) / select.duration));
    const end = from + Math.round(reach * (to - from));
    const runs = runsOf(units, (index) => {
      if (index >= count) return 'pending';
      return index >= from && index < end ? 'selected' : 'typed';
    });
    return { final, before: runs, after: [], caret: false, typing: false };
  }
  return {
    final,
    before: [{ kind: 'typed', text: units.slice(0, count).join('') }],
    after: [{ kind: 'pending', text: units.slice(count).join('') }],
    caret: caretShown(at),
    typing: isTyping(times, t),
  };
}

function Runs({ runs }: { runs: readonly Run[] }) {
  return runs.map((run, index) =>
    run.text === '' ? null : (
      <span key={`${index}-${run.kind}`} className="r08-type__run" data-kind={run.kind}>
        {run.text}
      </span>
    ),
  );
}

/**
 * A line typed on screen with the coral caret: at a person's pace or the app's shipped write-back
 * pace, with an optional drag selection in the coral wash and an in-place retype from one text to
 * another (the selection, or the whole line, replaced as the new words type in). Its box holds the
 * widest of both texts from the start, so a centered line never shifts as it types; place it with
 * its parent. English or Chinese, typed by grapheme.
 */
export function TypeLine(props: TypeLineProps) {
  const { t, lang, text, size = 'line', tone = 'fg', weight = 'display' } = props;
  const live = liveLine(props);
  return (
    <span
      className="r08-type"
      data-size={size}
      data-tone={tone}
      data-weight={weight}
      lang={langTag(lang)}
    >
      <span className="r08-type__ghost" aria-hidden="true">
        {text}
      </span>
      {live.final === text ? null : (
        <span className="r08-type__ghost" aria-hidden="true">
          {live.final}
        </span>
      )}
      <span className="r08-type__live">
        <Runs runs={live.before} />
        {live.caret ? (
          <span className="r08-type__caret">
            <Caret t={t} solid={live.typing} />
          </span>
        ) : null}
        <Runs runs={live.after} />
      </span>
    </span>
  );
}
