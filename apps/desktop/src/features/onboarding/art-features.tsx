import {
  Blocks,
  Camera,
  Check,
  Command,
  MousePointerClick,
  Sparkles,
  SquarePen,
  Zap,
} from 'lucide-react';
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
 * Atd's four additional pillars in one scene: an app it built (a miniature window with a
 * checklist and Atd's sparkle on its top-right corner), Computer use (a raised pointer badge
 * drifting gently between two upper targets), Extensions & Memory (a compact chip docked along the
 * window's upper-right edge), the mini panel docked on its left edge, and an automation card at its
 * lower-right corner. CSS loops run only under Reduce Motion `no-preference`: the last row writes
 * itself in, the automation's next run completes, and the pointer badge drifts between targets.
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
        <span className="guide-ext">
          <span className="guide-ext-icon">
            <Blocks strokeWidth={2.25} />
          </span>
          <span className="guide-ext-label" />
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
        <span className="guide-pointer">
          <MousePointerClick strokeWidth={2.25} />
        </span>
        <span className="guide-app-spark">
          <Sparkles fill="currentColor" />
        </span>
      </span>
    </ArtStage>
  );
}
