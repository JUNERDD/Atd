import type { Lang } from '../../../copy.ts';
import { typedCount } from '../../../kit/product/island.ts';
import { MacWindow } from '../../../kit/world/MacWindow.tsx';
import { graphemes } from '../../../kit/world/text-units.ts';
import { clamp01 } from '../../../motion/ease.ts';
import { blinkAt } from '../../world/typing.ts';
import { CHOOSE_BEATS as B } from './beats.ts';
import { content } from './content.ts';
import { NOTE, TEXT } from './note-layout.ts';

/** A line as it reads at one moment: kept text, then the selected part, then freshly written. */
interface LineState {
  kept: string;
  selected: string;
  rest: string;
  fresh: string;
  /** The field's caret after the fresh text (solid while it is being written). */
  caret: 'blink' | 'solid' | false;
}

/** `text` with its first `fraction` of graphemes selected. */
function selecting(text: string, fraction: number): Pick<LineState, 'kept' | 'selected' | 'rest'> {
  const all = graphemes(text);
  const count = Math.round(clamp01(fraction) * all.length);
  return { kept: '', selected: all.slice(0, count).join(''), rest: all.slice(count).join('') };
}

/** `text` written back at the shipped pace from `at`. */
function written(text: string, at: number, t: number): string {
  const all = graphemes(text);
  return all.slice(0, typedCount(t - at, all.length)).join('');
}

const sweep = (t: number, at: number) => clamp01((t - at) / 0.15);

/**
 * Line 1: typed roughly, selected and polished by the tap, selected again and rewritten in
 * Japanese by the hold.
 */
function line1(lang: Lang, t: number): LineState {
  const c = content[lang];
  if (t < B.tapWrite)
    return { ...selecting(c.rough, sweep(t, B.tapSelect)), fresh: '', caret: false };
  if (t < B.holdSelect) {
    const text = written(c.polished, B.tapWrite, t);
    return { kept: '', selected: '', rest: '', fresh: text, caret: 'blink' };
  }
  if (t < B.holdWrite) {
    return { ...selecting(c.polished, sweep(t, B.holdSelect)), fresh: '', caret: false };
  }
  const caret = t < B.dragStart ? 'blink' : false;
  return { kept: '', selected: '', rest: '', fresh: written(c.japanese, B.holdWrite, t), caret };
}

/** Line 2: dragged over with the mouse, then the translation is inserted right after it. */
function line2(lang: Lang, t: number, selection: number): LineState {
  const c = content[lang];
  if (t < B.whereWrite) return { ...selecting(c.doors, selection), fresh: '', caret: false };
  const fresh = written(c.doorsJapanese, B.whereWrite, t);
  return { kept: c.doors, selected: '', rest: '', fresh, caret: 'blink' };
}

function Line({
  state,
  t,
  top,
  glint,
}: {
  state: LineState;
  t: number;
  top: number;
  glint: number;
}) {
  const caretOn = state.caret === 'solid' || (state.caret === 'blink' && blinkAt(t) > 0.5);
  return (
    <div className="r08-choose__line" style={{ '--top': top - NOTE.y - 52 }}>
      {state.kept}
      {state.selected ? <span className="r08-choose__selected">{state.selected}</span> : null}
      {state.rest}
      {state.fresh ? (
        <span className="r08-choose__fresh" style={{ '--glint': glint }}>
          {state.fresh}
        </span>
      ) : null}
      {state.caret ? <span className="r08-choose__caret" data-on={caretOn || undefined} /> : null}
    </div>
  );
}

/** A completion glint on freshly written text: up as Written lands, gone over 0.9 s. */
const glintAt = (t: number, at: number) => (t < at ? 0 : Math.max(0, 1 - (t - at) / 0.9));

/**
 * The note on the display: a glass window titled for the launch, a heading, and the two lines
 * the commands work on. `selection` is line 2's drag selection (from the pointer).
 */
export function NoteWindow({ lang, t, selection }: { lang: Lang; t: number; selection: number }) {
  const c = content[lang];
  const first = line1(lang, t);
  const second = line2(lang, t, selection);
  const glint1 = Math.max(glintAt(t, B.tapDone), glintAt(t, B.holdDone));
  return (
    <MacWindow box={NOTE} title={c.noteTitle} material="glass">
      <div
        className="r08-choose__note"
        lang={lang === 'zh' ? 'zh-CN' : 'en'}
        style={{
          '--size': TEXT.size,
          '--lh': TEXT.lineHeight,
          '--pad': TEXT.x - NOTE.x,
          '--head': TEXT.headingSize,
        }}
      >
        <div className="r08-choose__heading" style={{ '--top': TEXT.heading - NOTE.y - 52 }}>
          {c.heading}
        </div>
        <Line state={first} t={t} top={TEXT.line1} glint={glint1} />
        <Line state={second} t={t} top={TEXT.line2} glint={glintAt(t, B.whereDone)} />
      </div>
    </MacWindow>
  );
}
