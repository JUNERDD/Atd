import type { Lang } from '../../copy.ts';
import { clamp01, easeIn } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { DropsGlyph } from './DropsGlyph.tsx';
import { strings } from './strings.ts';
import './tokens.css';
import './notification.css';

export interface NotificationProps {
  lang: Lang;
  /** The automation's name, as a delivered run's notification titles it (`Invoices`). */
  title: string;
  /** The run's summary; the shell's "Finished — open to see the result." by default. */
  body?: string | undefined;
  /** The time it shows; "now" by default. */
  time?: string | undefined;
  /** Seconds since it was posted: it slides in from the right on the `window` spring. */
  enter?: number | undefined;
  /** Seconds since it began to leave: it slides back out to the right. */
  exit?: number | undefined;
}

/**
 * A macOS 26 notification banner for an automation's result (`AutomationNotifier`): 344 pt of glass
 * with a 22 pt corner, the Atd app icon (the off-white tile with the black Drops mark), the title
 * and the time on one line and the body under them. Place its box at the top-right of the screen.
 */
export function Notification({ lang, title, body, time, enter, exit }: NotificationProps) {
  const t = strings[lang].notice;
  const shown = enter === undefined ? 1 : springAt(enter, 0, springs.window);
  const gone = exit === undefined ? 0 : easeIn(clamp01(exit / 0.35));
  const visible = enter === undefined || enter >= 0;
  return (
    <div
      className="glass pk-notice"
      data-glass="toast"
      style={{ '--shown': visible ? shown : 0, '--gone': gone }}
    >
      <span className="pk-app-icon">
        <DropsGlyph className="pk-app-icon__mark" />
      </span>
      <span className="pk-notice__text">
        <span className="pk-notice__head">
          <span className="pk-notice__title">{title}</span>
          <span className="pk-notice__time">{time ?? t.now}</span>
        </span>
        <span className="pk-notice__body">{body ?? t.delivered}</span>
      </span>
    </div>
  );
}
