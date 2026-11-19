import { Camera, Check, ScanText, ScrollText, Video } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArtStage } from './art-panel';
import './art-screenshot.css';
import { morphIn } from './step-motion';

/** The page's text lines, as skeleton bars whose widths `art-screenshot.css` sets by position. */
const LINES = [0, 1, 2, 3] as const;

/** The floating capture toolbar's mode buttons, with area capture active by default. */
const TOOLS = [
  { id: 'area', icon: Camera, active: true },
  { id: 'long', icon: ScrollText, active: false },
  { id: 'text', icon: ScanText, active: false },
  { id: 'record', icon: Video, active: false },
] as const;

/**
 * A page with an area picked on it, as a capture shows: skeleton text lines on the neutral page
 * card the other illustrations use, an accent capture frame with a highlighted text selection and
 * numbered annotation badge (`1`) inside it, and a raised floating capture toolbar pill below it
 * (area screenshot active, plus long screenshot, text selection, and screen recording). Once the
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
          <span className="guide-capture-annotation">
            <span className="guide-capture-highlight" />
            <span className="guide-capture-step">1</span>
          </span>
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
        <span className="guide-capture-toolbar">
          {TOOLS.map(({ id, icon: Icon, active }) => (
            <span key={id} className="guide-capture-tool" data-active={active || undefined}>
              <Icon strokeWidth={2.25} />
            </span>
          ))}
        </span>
      </span>
    </ArtStage>
  );
}
