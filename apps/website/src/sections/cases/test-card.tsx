import { useRef } from 'react';
import type { CaseFrame } from '../../content/cases';
import { useInView } from '../../lib/use-in-view';
import './test-card.css';

/** The seven bars of the halftone chart; CSS gives each its dot size. */
const BARS = [0, 1, 2, 3, 4, 5, 6] as const;

/** The format readout in the viewfinder: the shape of the recording that will replace the card. */
const FORMAT: Record<CaseFrame, string> = { screen: '16:10', panel: '420 × 580' };

interface TestCardProps {
  title: string;
  frame: CaseFrame;
  /** The card's place in the gallery, such as `02 / 05`. */
  position: string;
  label: string;
  /** Playback is on. The card also moves only while it is on screen. */
  motion: boolean;
}

/**
 * The placeholder for a case without a recording yet: a grayscale halftone test chart seen through
 * a camera viewfinder, with a blinking REC light and a running timecode around a slate that carries
 * the case title in dot-matrix type. Drawn with HTML and CSS only.
 */
export function TestCard({ title, frame, position, label, motion }: TestCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useInView(ref);

  return (
    <div
      ref={ref}
      className="tc"
      data-frame={frame}
      data-live={motion && onScreen ? '' : undefined}
    >
      <div className="tc__chart" aria-hidden="true">
        <div className="tc__bars">
          {BARS.map((bar) => (
            <span key={bar} className="tc__bar" />
          ))}
        </div>
        <div className="tc__ramp" />
      </div>
      <div className="tc__scan" aria-hidden="true" />
      <div className="tc__corners" aria-hidden="true" />
      <div className="tc__hud" data-edge="top" aria-hidden="true">
        <span className="tc__rec">REC</span>
        <Timecode />
      </div>
      <div className="tc__slate">
        <p className="tc__title" aria-hidden="true">
          {title}
        </p>
        <p className="tc__label">{label}</p>
      </div>
      <div className="tc__hud" data-edge="bottom" aria-hidden="true">
        <span>{FORMAT[frame]}</span>
        <span>{position}</span>
      </div>
    </div>
  );
}

/**
 * `00:MM:SS:FF` at 30 frames a second. Each digit is a reel of numerals that a `steps()` animation
 * moves one numeral at a time, so the count runs on transforms alone.
 */
function Timecode() {
  return (
    <span className="tc__timecode">
      00:
      <span className="tc__reel" data-unit="m10" />
      <span className="tc__reel" data-unit="m1" />:
      <span className="tc__reel" data-unit="s10" />
      <span className="tc__reel" data-unit="s1" />:
      <span className="tc__reel" data-unit="f10" />
      <span className="tc__reel" data-unit="f1" />
    </span>
  );
}
