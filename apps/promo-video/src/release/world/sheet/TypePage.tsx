import { DotField } from '../DotField.tsx';
import { Caret } from '../Caret.tsx';
import { TypeLine } from '../TypeLine.tsx';
import type { Pulse } from '../dots.ts';
import { TYPE_PAGE } from './beats.ts';
import { content } from './content.ts';

const PULSES: readonly Pulse[] = [
  { x: 960, y: 470, at: 0.3, strength: 0.6, tint: 'coral' },
  { x: 960, y: 470, at: TYPE_PAGE.select, strength: 0.7 },
  { x: 960, y: 470, at: TYPE_PAGE.replace, strength: 1.2, tint: 'coral' },
  { x: 420, y: 760, at: 2.4, strength: 0.8 },
];

/**
 * The typing page: the dot field with pulses, a free-standing caret keeping the beat, an English
 * line typed by a person, drag-selected in the coral wash and retyped in place at the shipped pace,
 * and a Chinese line doing the same below.
 */
export function TypePage({ t }: { t: number }) {
  const en = content.en;
  const zh = content.zh;
  return (
    <>
      <DotField t={t} pulses={PULSES} />
      <div className="r08-sheet__label">{en.labels.type}</div>
      <Caret t={t} x={96} y={160} height={96} />
      <div className="r08-sheet__type" data-row="en">
        <TypeLine
          t={t}
          lang="en"
          text={en.messy}
          at={TYPE_PAGE.type}
          select={{ at: TYPE_PAGE.select, duration: 0.45 }}
          replace={{ text: en.polished, at: TYPE_PAGE.replace, pace: 'shipped' }}
        />
      </div>
      <div className="r08-sheet__type" data-row="zh">
        <TypeLine
          t={t}
          lang="zh"
          text={zh.messy}
          at={TYPE_PAGE.zh}
          pace={9}
          size="label"
          select={{ at: TYPE_PAGE.select + 0.3, duration: 0.3 }}
          replace={{ text: zh.polished, at: TYPE_PAGE.replace + 0.15, pace: 'shipped' }}
        />
      </div>
    </>
  );
}
