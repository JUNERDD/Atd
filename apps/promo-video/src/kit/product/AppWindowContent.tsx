import type { Lang } from '../../copy.ts';
import { HabitCell } from './HabitCell.tsx';
import { checkAt, checkState, weekdays, type Habit, type HabitCheck } from './habits.ts';
import './tokens.css';
import './habits.css';
import './app-window.css';

export interface AppWindowContentProps {
  lang: Lang;
  /** The app's name, the scene's content (`Habit Tracker`). */
  title: string;
  /** A line under it (`This week`). */
  subtitle?: string | undefined;
  habits: readonly Habit[];
  /** The week's checks; those with `at` fill in at that moment. */
  checks: readonly HabitCheck[];
  /** The clock, in seconds. */
  time: number;
  /** Today's column, 0 Monday … 6 Sunday. Default 3. */
  today?: number | undefined;
  /**
   * `glass` lets the window's own material show through (the world kit's window draws it);
   * `opaque` paints the app's dark surface. Default `opaque`.
   */
  material?: 'glass' | 'opaque' | undefined;
}

/**
 * The body of the habit tracker's window (the window's chrome is the world kit's `MacWindow`): the
 * title, a week grid with a row per habit and a column per day, today's column lit, each row's
 * count at its end. Checks pop in and draw their tick when they land. 440 pt wide; its height
 * follows the habits.
 */
export function AppWindowContent({
  lang,
  title,
  subtitle,
  habits,
  checks,
  time,
  today = 3,
  material = 'opaque',
}: AppWindowContentProps) {
  const days = weekdays(lang);
  return (
    <div className="pk-habits pk-app" data-material={material}>
      <div className="pk-app__head">
        <span className="pk-app__title">{title}</span>
        {subtitle && <span className="pk-app__subtitle">{subtitle}</span>}
      </div>
      <div className="pk-app__grid">
        <span />
        {days.map((day, index) => (
          <span key={index} className="pk-app__day" data-today={index === today || undefined}>
            {day}
          </span>
        ))}
        <span />
        {habits.map((habit, row) => {
          const count = days.filter((_, day) => {
            const check = checkAt(checks, row, day);
            return check !== undefined && checkState(check, time).pop > 0.5;
          }).length;
          return [
            <span key={`name-${row}`} className="pk-app__habit">
              {habit.name}
            </span>,
            ...days.map((_, day) => (
              <HabitCell
                key={`${row}-${day}`}
                checks={checks}
                habit={row}
                day={day}
                time={time}
                today={day === today}
              />
            )),
            <span key={`count-${row}`} className="pk-app__count">
              {count}/7
            </span>,
          ];
        })}
      </div>
    </div>
  );
}
