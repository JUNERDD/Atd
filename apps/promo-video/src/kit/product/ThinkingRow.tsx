import { Sparkles } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { arrival, present } from './motion.ts';
import { fill, strings } from './strings.ts';
import { shimmerAt } from './text.ts';
import './tokens.css';
import './activity.css';

export interface ThinkingRowProps {
  lang: Lang;
  /**
   * Seconds the model thought, which the settled row reads ("Thought 4s"). Omit while it is still
   * thinking: the row then reads "Thinking" under the moving shimmer.
   */
  seconds?: number | undefined;
  /** The settled row's muted excerpt: the thought's first heading or sentence. */
  excerpt?: string | undefined;
  /** The film's clock in seconds, which moves the live shimmer. */
  time?: number | undefined;
  /** Seconds since the row appeared. */
  age?: number | undefined;
}

/**
 * A reasoning row (`thinking-block.tsx`): the 14 pt sparkles, then "Thinking" shimmering while it
 * runs, or "Thought 4s" and a muted excerpt once it settles.
 */
export function ThinkingRow({ lang, seconds, excerpt, time = 0, age }: ThinkingRowProps) {
  if (!present(age)) return null;
  const t = strings[lang].thinking;
  const live = seconds === undefined;
  return (
    <div className="pk-arrive" style={{ '--in': arrival(age) }}>
      <div className="pk-row">
        <Sparkles className="pk-icon pk-row__icon" strokeWidth={1.75} />
        {live ? (
          <span className="pk-row__title pk-shimmer" style={{ '--shimmer': shimmerAt(time) }}>
            {t.live}
          </span>
        ) : (
          <>
            <span className="pk-row__title">
              {fill(t.done, { elapsed: `${Math.round(seconds)}s` })}
            </span>
            {excerpt && <span className="pk-row__meta">{excerpt}</span>}
          </>
        )}
      </div>
    </div>
  );
}
