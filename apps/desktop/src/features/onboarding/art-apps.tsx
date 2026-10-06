import { Check, Sparkles } from 'lucide-react';
import { ArtStage } from './art-panel';
import './art-apps.css';

/** The app's list rows; the first two are checked off, the last is the one being written. */
const ROWS = [0, 1, 2] as const;

/** The widget's chart columns, whose heights `art-apps.css` sets by position. */
const COLUMNS = [0, 1, 2, 3, 4] as const;

/**
 * An app Atd built, on the desktop: a miniature app window (traffic lights and a title in its
 * title bar, a short checklist below) on the neutral page card the other illustrations use, the
 * app's widget pinned in front of the window's lower right corner, and Atd's sparkle (the Create
 * app icon) on its top right corner, where the step's light sets off round the window. Two CSS
 * loops, still under Reduce Motion: the last row writes itself in again and again, and the widget
 * floats like the provider marks.
 */
export function AppsArt() {
  return (
    <ArtStage name="apps">
      <span className="guide-app">
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
        <span className="guide-app-widget">
          <span className="guide-app-widget-label" />
          <span className="guide-app-chart">
            {COLUMNS.map((column) => (
              <span key={column} className="guide-app-column" />
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
