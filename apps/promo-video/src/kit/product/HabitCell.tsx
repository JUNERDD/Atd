import { checkAt, checkState, type HabitCheck } from './habits.ts';
import './tokens.css';
import './habits.css';

/**
 * One day of one habit: an empty ring, or a filled disc whose tick draws in as the check lands.
 * Today's empty ring is brighter.
 */
export function HabitCell({
  checks,
  habit,
  day,
  time,
  today,
}: {
  checks: readonly HabitCheck[];
  habit: number;
  day: number;
  time: number;
  today: boolean;
}) {
  const check = checkAt(checks, habit, day);
  const { pop, draw } = check ? checkState(check, time) : { pop: 0, draw: 0 };
  return (
    <span className="pk-habit-cell" data-today={today || undefined}>
      <svg viewBox="0 0 24 24" className="pk-habit-cell__svg">
        <circle className="pk-habit-cell__ring" cx="12" cy="12" r="10.5" />
        {pop > 0 && (
          <circle className="pk-habit-cell__fill" cx="12" cy="12" r="11" style={{ '--pop': pop }} />
        )}
        {draw > 0 && (
          <path
            className="pk-habit-cell__tick"
            d="m7.5 12.5 3 3 6-6.5"
            pathLength={1}
            style={{ '--draw': draw }}
          />
        )}
      </svg>
    </span>
  );
}
