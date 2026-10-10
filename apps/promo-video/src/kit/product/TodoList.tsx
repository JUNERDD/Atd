import type { Lang } from '../../copy.ts';
import { easeOut, ramp } from '../../motion/ease.ts';
import { springs } from '../../motion/spring.ts';
import { arrival, present } from './motion.ts';
import { StatusGlyph, type GlyphState } from './StatusGlyph.tsx';
import { fill, strings } from './strings.ts';
import './tokens.css';
import './popover.css';
import './todos.css';

export interface Todo {
  text: string;
  /** When it ticks, in seconds on the same clock as `time`. */
  done: number;
}

export interface TodoListProps {
  lang: Lang;
  /** The plan, in order. Each item works while the one before it is done, then ticks at `done`. */
  items: readonly Todo[];
  /** The clock, in seconds. */
  time: number;
  /** When the first item starts working (its spinner turns). Default 0. */
  start?: number | undefined;
  /** Seconds since the popover opened. */
  age?: number | undefined;
}

/** Each item's state at `time`: done items, then the one being worked on, then the rest. */
function stateAt(items: readonly Todo[], index: number, time: number, start: number): GlyphState {
  const item = items[index];
  if (!item) return 'pending';
  if (time >= item.done) return 'completed';
  const begun = index === 0 ? start : (items[index - 1]?.done ?? Infinity);
  return time >= begun ? 'running' : 'pending';
}

/**
 * The Todos view of the composer popover (`todo-list.tsx`): "Todos" and "2 of 5 done" over the
 * plan, each item with its glyph (an empty circle waiting, a spinner while worked on, a check once
 * done), done items muted and struck through. A tick draws its check and its strike in 0.35 s.
 */
export function TodoList({ lang, items, time, start = 0, age }: TodoListProps) {
  if (!present(age)) return null;
  const t = strings[lang].todos;
  const completed = items.filter((item) => time >= item.done).length;
  return (
    <div className="glass pk-popover pk-todos" style={{ '--in': arrival(age, springs.snappy) }}>
      <div className="pk-todos__header">
        <span className="pk-todos__title">{t.title}</span>
        <span className="pk-todos__count">
          {fill(t.progress, { completed, total: items.length })}
        </span>
      </div>
      <ul className="pk-todos__list">
        {items.map((item, index) => {
          const state = stateAt(items, index, time, start);
          const tick = state === 'completed' ? ramp(time, item.done, 0.35, easeOut) : 0;
          return (
            <li key={index} className="pk-todo" data-state={state} style={{ '--tick': tick }}>
              <StatusGlyph state={state} draw={tick} time={time} />
              <span className="pk-todo__text">{item.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
