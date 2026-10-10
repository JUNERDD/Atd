import type { Lang } from '../../copy.ts';
import { clamp01 } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { HabitCell } from './HabitCell.tsx';
import { checkAt, checkState, weekdays, type Habit, type HabitCheck } from './habits.ts';
import './tokens.css';
import './habits.css';
import './pinned-widget.css';

export interface PinnedWidgetProps {
  lang: Lang;
  /** The app's name (`Habit Tracker`). */
  title: string;
  habits: readonly Habit[];
  checks: readonly HabitCheck[];
  /** The clock, in seconds. */
  time: number;
  /** Today's column, 0 Monday … 6 Sunday. Default 3. */
  today?: number | undefined;
  /**
   * `small` (170 × 170 pt): today's ring and count; `medium` (364 × 170 pt): every habit's week.
   */
  size?: 'small' | 'medium' | undefined;
  /** Seconds since it landed on the wallpaper: it settles from 106% on the `window` spring. */
  land?: number | undefined;
}

/**
 * The app pinned to the desktop: its card as an Atd window on the wallpaper, in widget sizes, on
 * the shared glass with a 22 pt corner.
 */
export function PinnedWidget({
  lang,
  title,
  habits,
  checks,
  time,
  today = 3,
  size = 'small',
  land,
}: PinnedWidgetProps) {
  const settle = land === undefined ? 1 : springAt(land, 0, springs.window);
  const doneToday = habits.filter((_, row) => {
    const check = checkAt(checks, row, today);
    return check !== undefined && checkState(check, time).pop > 0.5;
  }).length;
  const share = habits.length > 0 ? doneToday / habits.length : 0;
  const days = weekdays(lang);
  const todayName = weekdays(lang, 'short')[today];
  return (
    <div
      className="glass pk-habits pk-pin"
      data-glass="toast"
      data-size={size}
      style={{ '--settle': land !== undefined && land < 0 ? 0 : settle }}
    >
      <span className="pk-pin__title">{title}</span>
      {size === 'small' ? (
        <div className="pk-pin__today">
          <svg className="pk-pin__ring" viewBox="0 0 64 64">
            <circle className="pk-pin__track" cx="32" cy="32" r="27" />
            {share > 0 && (
              <circle
                className="pk-pin__value"
                cx="32"
                cy="32"
                r="27"
                pathLength={100}
                style={{ '--ring': clamp01(share) * 100 }}
              />
            )}
          </svg>
          <span className="pk-pin__count">
            {doneToday}/{habits.length}
          </span>
          <span className="pk-pin__day">{todayName}</span>
        </div>
      ) : (
        <div className="pk-pin__rows">
          {habits.map((habit, row) => (
            <div key={row} className="pk-pin__row">
              <span className="pk-pin__habit">{habit.name}</span>
              {days.map((_, day) => (
                <HabitCell
                  key={day}
                  checks={checks}
                  habit={row}
                  day={day}
                  time={time}
                  today={day === today}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
