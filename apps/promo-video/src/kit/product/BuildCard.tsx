import type { ReactNode } from 'react';
import { AppWindow, History, LayoutGrid, SquareArrowOutUpRight } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01 } from '../../motion/ease.ts';
import { arrival, present } from './motion.ts';
import { fill, strings } from './strings.ts';
import { shimmerAt } from './text.ts';
import './tokens.css';
import './activity.css';
import './build-card.css';

export interface BuildCardProps {
  lang: Lang;
  /** The app's name, which the scene gives (`Habit Tracker`). */
  name: string;
  /** The build's change note, two lines at most. */
  summary?: string | undefined;
  version?: number | undefined;
  /** The app's icon, filling its 32 pt tile; a muted grid glyph stands in without one. */
  icon?: ReactNode;
  /** The build's progress, 0 → 1, drawn as a bar along the footer while it builds. */
  build?: number | undefined;
  /**
   * Seconds since the build was published: the footer gives way to Open and Version history.
   * Omit (or negative) while it is still building.
   */
  built?: number | undefined;
  /** Open held down, 0 → 1. */
  press?: number | undefined;
  /** The film's clock, for the row's shimmer while it builds. */
  time?: number | undefined;
  /** Seconds since the card appeared. */
  age?: number | undefined;
}

/**
 * The app a build published (`app-card.tsx`), under its "Build app" row: the icon tile, the name
 * with its version badge and the change note; while it builds, "Type-checking and building version
 * 1…" in the footer with a progress bar, then Open and Version history.
 */
export function BuildCard({
  lang,
  name,
  summary,
  version = 1,
  icon,
  build = 0,
  built,
  press = 0,
  time = 0,
  age,
}: BuildCardProps) {
  if (!present(age)) return null;
  const t = strings[lang].app;
  const ready = built !== undefined && built >= 0;
  const reveal = ready ? clamp01(built / 0.3) : 0;
  return (
    <div className="pk-arrive" style={{ '--in': arrival(age) }}>
      <div>
        <div className="pk-row">
          <AppWindow className="pk-icon pk-row__icon" strokeWidth={1.75} />
          <span
            className={ready ? 'pk-row__meta' : 'pk-row__meta pk-shimmer'}
            style={ready ? undefined : { '--shimmer': shimmerAt(time) }}
          >{`${t.step} ${name}`}</span>
        </div>
        <div className="pk-build-slot">
          <div className="pk-card pk-build">
            <div className="pk-build__body">
              <div className="pk-build__head">
                <span className="pk-build__tile">{icon ?? <LayoutGrid className="pk-icon" />}</span>
                <span className="pk-build__text">
                  <span className="pk-build__title">
                    <span className="pk-build__name">{name}</span>
                    <span className="pk-badge">{fill(t.version, { version })}</span>
                  </span>
                  {summary && <span className="pk-build__summary">{summary}</span>}
                </span>
              </div>
              {ready && (
                <div className="pk-build__actions" style={{ '--reveal': reveal }}>
                  <span className="pk-button" data-size="sm" style={{ '--press': clamp01(press) }}>
                    <SquareArrowOutUpRight className="pk-icon" />
                    {t.open}
                  </span>
                  <span className="pk-button" data-size="sm">
                    <History className="pk-icon" />
                    {t.history}
                  </span>
                </div>
              )}
            </div>
            {!ready && (
              <div className="pk-card__footer pk-build__footer">
                {fill(t.building, { version })}
                <span className="pk-build__bar" style={{ '--build': clamp01(build) }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
