import type { RefObject } from 'react';
import './display.css';
import './panel.css';

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
  return (
    <div
      ref={ref}
      className="summon__display"
      aria-hidden="true"
      data-open={open ? '' : undefined}
      data-kept={kept ? '' : undefined}
      data-live={live ? '' : undefined}
    >
      <span className="summon__axis" data-axis="x">
        1512 pt
      </span>
      <span className="summon__axis" data-axis="y">
        982 pt
      </span>
      <div className="summon__viewport">
        <div className="summon__screen">
          <div className="summon__menubar">
            <span className="summon__menus" />
            <span className="summon__extras" />
            <span className="summon__mark" />
          </div>
          <p className="summon__state">{state}</p>
          <div className="summon__window">
            <span className="summon__window-bar" />
            <span className="summon__line" data-w="1" />
            <span className="summon__line" data-w="2" />
            <span className="summon__line" data-w="3" />
            <span className="summon__line" data-w="2" />
          </div>
          <div className="summon__ghost" />
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
