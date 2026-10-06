import type { RefObject } from 'react';
import { useDrawingText } from './use-drawing-text';
import './display.css';
import './panel.css';
import './plot.css';

/** The text lines in the window behind the panel, by width (display.css). */
const WINDOW_LINES = ['1', '2', '3', '2'] as const;

interface SummonDisplayProps {
  ref: RefObject<HTMLDivElement | null>;
  open: boolean;
  /** The panel came back after being hidden: its draft is marked as kept. */
  kept: boolean;
  /** The section is near the viewport, so the caret may blink. */
  live: boolean;
  state: string;
  draft: string;
  draftKept: string;
}

/**
 * An engineering drawing of a 1512 × 982 pt display. Everything inside is laid out in display points
 * (`--pt`, from the drawing's width), so the panel is drawn true to scale: 420 × 580 pt, 16 pt from
 * the bottom-right corner. Hidden from assistive tech; the section describes it in text.
 *
 * It plots itself as it arrives, one reveal group timed in ms from its trigger: the overall
 * dimensions draw out from their labels while the numbers count (0–60), the screen powers on behind
 * a scan line (100), the menu bar draws (420), the window fades in and its lines draw one by one
 * (480–710), the state readout decodes (640) and the panel's slot appears (760). The panel itself is
 * the demo's: it springs up once the drawing has plotted (use-summon-demo.ts).
 */
export function SummonDisplay({
  ref,
  open,
  kept,
  live,
  state,
  draft,
  draftKept,
}: SummonDisplayProps) {
  useDrawingText(ref, open, state);

  return (
    <div
      ref={ref}
      className="summon__display"
      aria-hidden="true"
      data-reveal-group=""
      data-open={open ? '' : undefined}
      data-kept={kept ? '' : undefined}
      data-live={live ? '' : undefined}
    >
      <span className="summon__axis" data-axis="x" data-reveal="count" data-reveal-delay="0">
        1512 pt
      </span>
      <span className="summon__axis" data-axis="y" data-reveal="count" data-reveal-delay="60">
        982 pt
      </span>
      <div className="summon__viewport">
        <div className="summon__screen" data-reveal="power" data-reveal-delay="100">
          <div className="summon__menubar" data-reveal="draw" data-reveal-delay="420">
            <span className="summon__menus" />
            <span className="summon__extras" />
            <span className="summon__mark" />
          </div>
          <p className="summon__state" data-reveal="decode" data-reveal-delay="640">
            {state}
          </p>
          <div className="summon__window" data-reveal="fade" data-reveal-delay="480">
            <span className="summon__window-bar" data-reveal="draw" data-reveal-delay="520" />
            {WINDOW_LINES.map((width, index) => (
              <span
                className="summon__line"
                key={index}
                data-w={width}
                data-reveal="draw"
                data-reveal-delay={560 + index * 50}
              />
            ))}
          </div>
          <div className="summon__ghost" data-reveal="fade" data-reveal-delay="760" />
          <div className="summon__panel">
            <div className="summon__panel-head">
              <span className="summon__bar" data-w="title" />
              <span className="summon__icon" />
              <span className="summon__icon" />
            </div>
            <div className="summon__thread">
              <span className="summon__bubble" />
              <span className="summon__bar" data-w="1" />
              <span className="summon__bar" data-w="2" />
              <span className="summon__bar" data-w="3" />
              <span className="summon__tool" />
            </div>
            <div className="summon__composer">
              <span className="summon__kept">{draftKept}</span>
              <p className="summon__draft">
                <span className="summon__draft-text">{draft}</span>
                <span className="summon__caret" />
              </p>
              <div className="summon__composer-foot">
                <span className="summon__pill" />
                <span className="summon__pill" />
                <span className="summon__send" />
              </div>
            </div>
          </div>
          <span className="summon__dim" data-dim="width">
            420
          </span>
          <span className="summon__dim" data-dim="height">
            580
          </span>
        </div>
        {/* The power-on scan line, timed with the screen (plot.css). */}
        <span className="summon__scan" data-reveal="fade" data-reveal-delay="100" />
        <span className="summon__gap" data-gap="right">
          16
        </span>
        <span className="summon__gap" data-gap="bottom">
          16
        </span>
      </div>
    </div>
  );
}
