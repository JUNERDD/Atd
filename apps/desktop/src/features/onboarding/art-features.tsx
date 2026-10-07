import { Camera, Check, Command, Sparkles, SquarePen, Zap } from 'lucide-react';
import { ArtStage } from './art-panel';
import './art-features.css';

/** The app's list rows; the first two are checked off, the last is the one being written. */
const ROWS = [0, 1, 2] as const;

/** The automation's runs along its time line; the first two are done, the third comes due. */
const RUNS = [0, 1, 2] as const;

/** The mini panel's quick actions, in the capsule's order. */
const ACTIONS = [
  { id: 'newTask', icon: SquarePen },
  { id: 'screenshot', icon: Camera },
  { id: 'commands', icon: Command },
] as const;

/**
 * Three more things Atd does, in one scene: an app it built (a miniature window with a checklist,
 * Atd's sparkle on its top right corner, where the step's light sets off), the mini panel docked
 * on the window's left edge (a slim capsule of quick actions) and an automation in front of its
 * lower right corner (a raised card with a bolt, its name and schedule, and a time line of runs).
 * Two CSS loops, still under Reduce Motion: the last row writes itself in again and again, and the
 * automation's next run comes due and completes.
 */
export function FeaturesArt() {
  return (
    <ArtStage name="features">
      <span className="guide-scene">
        <span className="guide-app-window">
          <span className="guide-app-titlebar">
            <span className="guide-app-dot" />
            <span className="guide-app-dot" />
            <span className="guide-app-dot" />
            <span className="guide-app-title" />
          </span>
          <span className="guide-app-list">
            {ROWS.map((row) => (
              <span key={row} className="guide-app-row">
                <span className="guide-app-check" data-done={row < 2 || undefined}>
                  {row < 2 && <Check />}
                </span>
                <span className="guide-app-line" />
              </span>
            ))}
          </span>
        </span>
        <span className="guide-mini">
          {ACTIONS.map(({ id, icon: Icon }) => (
            <span key={id} className="guide-mini-action">
              <Icon strokeWidth={2.25} />
            </span>
          ))}
        </span>
        <span className="guide-auto">
          <span className="guide-auto-head">
            <span className="guide-auto-badge">
              <Zap fill="currentColor" strokeWidth={1} />
            </span>
            <span className="guide-auto-text">
              <span className="guide-auto-label" />
              <span className="guide-auto-label" />
            </span>
          </span>
          <span className="guide-auto-line">
            <span className="guide-auto-track" />
            <span className="guide-auto-run" />
            <span className="guide-auto-next" />
            {RUNS.map((run) => (
              <span key={run} className="guide-auto-tick" data-done={run < 2 || undefined} />
            ))}
          </span>
        </span>
        <span className="guide-app-spark">
          <Sparkles fill="currentColor" />
        </span>
      </span>
    </ArtStage>
  );
}
