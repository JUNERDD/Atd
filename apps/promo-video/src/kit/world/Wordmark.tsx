import { clamp01 } from '../../motion/ease.ts';
import { WORDMARK, wordmarkWidthEm } from './wordmark.ts';
import './drops.css';

interface WordmarkProps {
  /**
   * 0 → 1: the word slides out from behind its left edge (where the mark sits in a lockup), its
   * blur clearing. Pass a spring's progress (e.g. `springAt(t, wordmark, springs.smooth)`).
   */
  reveal: number;
  /** Font size, in px. */
  size: number;
}

/**
 * "Atd" set in Inter, clipped at its left edge so it emerges from behind whatever stands there.
 * The box is the word's width plus nothing: place it where the word should rest.
 */
export function Wordmark({ reveal, size }: WordmarkProps) {
  const r = Math.max(0, reveal);
  return (
    <div className="wordmark" style={{ '--size': `${size}px`, '--width': wordmarkWidthEm() }}>
      <span
        className="wordmark__text"
        style={{
          '--shift': 1 - r,
          '--o': clamp01(r * 1.6),
          '--blur': `${(1 - clamp01(r)) * 0.06}em`,
        }}
      >
        {WORDMARK.text}
      </span>
    </div>
  );
}
