import type { Lang } from '../../../copy.ts';
import { textUnits } from '../../../kit/world/text-units.ts';
import { Caret } from '../../world/Caret.tsx';
import { Statement } from '../../world/Statement.tsx';
import type { WordBeats } from './beats.ts';
import { statementLines, type Vignette } from './content.ts';
import './yours.css';

/** Seconds between the first line's words, and between the payoff line's. */
const FIRST_STAGGER = 0.075;
const PAYOFF_STAGGER = 0.05;
/** The caret holds solid this long after a line lands, as while typing, then blinks on the beat. */
const SOLID = 0.3;

interface WordsProps {
  t: number;
  lang: Lang;
  vignette: Vignette;
  beats: WordBeats;
}

/**
 * A vignette's statement in the column left of the shot: its first line rises a sixteenth after
 * the cut, in the muted tone, and the coral caret waits after it, blinking on the beat; on the
 * payoff the second line rises in full white and the caret moves to its end. Both rise out
 * together before the next cut (or stay for the wipe).
 */
export function Words({ t, lang, vignette, beats }: WordsProps) {
  const [first, second] = statementLines(lang, vignette);
  const firstTimes = textUnits(first, lang).map((_, index) => beats.first + index * FIRST_STAGGER);
  const secondTimes = textUnits(second, lang).map(
    (_, index) => beats.payoff + index * PAYOFF_STAGGER,
  );
  const leaving = beats.out !== undefined && t >= beats.out;
  const onFirst = t >= beats.first && t < beats.payoff && !leaving;
  const onSecond = t >= beats.payoff && !leaving;
  return (
    <div className="r08-yours-words" data-lang={lang}>
      <div className="r08-yours-words__line">
        <Statement
          t={t}
          lang={lang}
          text={first}
          at={beats.first}
          times={firstTimes}
          tone="muted"
          align="left"
          {...(beats.out === undefined ? {} : { out: beats.out, outStagger: 0.03 })}
        />
        <span className="r08-yours-words__caret" data-on={onFirst || undefined}>
          <Caret t={t} solid={t < beats.first + SOLID} />
        </span>
      </div>
      <div className="r08-yours-words__line">
        <Statement
          t={t}
          lang={lang}
          text={second}
          at={beats.payoff}
          times={secondTimes}
          align="left"
          {...(beats.out === undefined ? {} : { out: beats.out + 0.06, outStagger: 0.03 })}
        />
        <span className="r08-yours-words__caret" data-on={onSecond || undefined}>
          <Caret t={t} solid={t < beats.payoff + SOLID} glow={0.9} />
        </span>
      </div>
    </div>
  );
}
