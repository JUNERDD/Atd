import { DropsMark } from './DropsMark.tsx';
import { Wordmark } from './Wordmark.tsx';
import { wordmarkWidthEm } from './wordmark.ts';
import './drops.css';

/** The wordmark's size and gap, relative to the mark's box. */
const WORD_SCALE = 0.84;
const GAP = 0.2;

interface LockupProps {
  /** See `DropsMark`. */
  formation: number;
  settle?: number;
  glow?: number;
  /**
   * 0 → 1: the wordmark slides out from behind the mark while the pair recenters, so the mark
   * starts centered on its own and the finished lockup is centered as a whole. A spring's progress.
   */
  reveal: number;
  /** The mark's box, in px. Default 280. */
  size?: number;
  reach?: number;
}

/**
 * The mark and the wordmark as one centered lockup: the Open and the Finale's sign-off. It is
 * centered on its parent's center; its own box is zero-sized, so it never shifts layout.
 */
export function Lockup({ formation, settle, glow, reveal, size = 280, reach }: LockupProps) {
  const word = wordmarkWidthEm() * size * WORD_SCALE;
  const shift = ((GAP * size + word) / 2) * reveal;
  return (
    <div className="lockup" style={{ '--size': `${size}px`, '--shift': `${shift}px` }}>
      <div className="lockup__mark">
        <DropsMark
          formation={formation}
          size={size}
          {...(settle === undefined ? {} : { settle })}
          {...(glow === undefined ? {} : { glow })}
          {...(reach === undefined ? {} : { reach })}
        />
      </div>
      <div className="lockup__word" style={{ '--gap': GAP }}>
        <Wordmark reveal={reveal} size={size * WORD_SCALE} />
      </div>
    </div>
  );
}
