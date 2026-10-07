import { useRef } from 'react';
import { useInView } from '../../lib/use-in-view';
import { useRevealed } from '../../motion/use-revealed';
import { DAYS, HOURS, runsAt, type PresetId } from './presets';
import './week.css';

const HOUR_LABELS = ['00', '06', '12', '18'];

/**
 * The power-on wave's timing, which week.css repeats for the dots: the top-left cell comes on
 * WAVE_LEAD ms into the matrix's entrance and each next diagonal WAVE_STEP ms later. The day and
 * hour labels decode as the wave reaches them.
 */
const WAVE_LEAD = 240;
const WAVE_STEP = 18;

interface WeekProps {
  preset: PresetId;
  /** Monday first, as the grid's rows. */
  days: readonly string[];
}

/**
 * The week as an LED matrix on its own display, Monday to Sunday by hour, lit in the hours the
 * preset runs in. It powers
 * on as a diagonal wave when it arrives; then, while it is on screen, a playhead sweeps the day and
 * each lit hour flashes as it passes. Picking another example relights its hours left to right (each
 * 3-hour band is a `data-step`, 20 ms apart). Hidden from assistive tech: the rule readout states the
 * same schedule in text.
 *
 * The matrix is a reveal item as well as a group, so it has its own trigger and its `--rv-delay`
 * (the reveal's cascade slot) times the dots' wave in step with the labels. Its own `fade` is only
 * there to hold it hidden until then; the wave is the entrance.
 */
export function Week({ preset, days }: WeekProps) {
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useRevealed(ref);
  const onScreen = useInView(ref);

  return (
    <div
      ref={ref}
      className="auto__week display"
      aria-hidden="true"
      data-reveal="fade"
      data-reveal-group=""
      data-live={revealed && onScreen ? '' : undefined}
    >
      <span />
      {HOUR_LABELS.map((label, index) => (
        <span
          className="auto__hour"
          key={label}
          data-reveal="decode"
          data-reveal-delay={WAVE_LEAD + index * 6 * WAVE_STEP}
        >
          {label}
        </span>
      ))}
      {days.slice(0, DAYS).map((day, dayIndex) => (
        <span className="auto__row" key={day} data-day={dayIndex}>
          <span
            className="auto__day"
            data-reveal="decode"
            data-reveal-delay={WAVE_LEAD + dayIndex * WAVE_STEP}
          >
            {day}
          </span>
          {Array.from({ length: HOURS }, (_, hour) => (
            <span
              className="auto__cell"
              key={hour}
              data-step={Math.floor(hour / 3)}
              data-sub={hour % 3}
              data-on={runsAt(preset, dayIndex, hour) ? '' : undefined}
            />
          ))}
        </span>
      ))}
      <span className="auto__scan">
        <span className="auto__scan-beam" />
      </span>
    </div>
  );
}
