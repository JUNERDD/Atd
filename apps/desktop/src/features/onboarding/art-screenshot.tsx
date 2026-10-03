import { Check } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArtStage } from './art-panel';
import './art-screenshot.css';
import { morphIn } from './step-motion';

/** The page's text lines, as skeleton bars whose widths `art-screenshot.css` sets by position. */
const LINES = [0, 1, 2, 3] as const;

/**
 * A page with an area picked on it, as a capture shows: skeleton text lines on the neutral page
 * card the other illustrations use, and over them the capture frame, an accent outline with a
 * handle on each corner that breathes slightly (a CSS loop, still under Reduce Motion). Once the
 * app may capture, a done badge morphs onto the frame's corner.
 */
export function ScreenshotArt({ granted }: { granted: boolean }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <ArtStage name="screenshot">
      <span className="guide-capture">
        <span className="guide-capture-page">
          {LINES.map((line) => (
            <span key={line} className="guide-capture-line" />
          ))}
        </span>
        <span className="guide-capture-frame">
          <span className="guide-capture-handle" data-corner="nw" />
          <span className="guide-capture-handle" data-corner="ne" />
          <span className="guide-capture-handle" data-corner="sw" />
          <span className="guide-capture-handle" data-corner="se" />
          <AnimatePresence initial={false}>
            {granted && (
              <motion.span key="done" className="guide-done-badge" {...morphIn(reduced)}>
                <Check />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </span>
    </ArtStage>
  );
}
