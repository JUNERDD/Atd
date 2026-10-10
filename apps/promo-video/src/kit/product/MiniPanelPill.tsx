import { FilePlus } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { easeOut, mix, smoothstep } from '../../motion/ease.ts';
import { springAt } from '../../motion/spring.ts';
import { strings } from './strings.ts';
import './tokens.css';
import './mini-panel.css';

/** The shapes the body takes (`MiniPanelMetrics`), as [thickness, length, inset from the edge]. */
const PILL = [6, 44, 4] as const;
const INVITE = [44, 96, 8] as const;
const TARGET = [184, 112, 8] as const;
/** The drop card's corner; the pill and the invite are capsules. */
const CARD_RADIUS = 18;

export interface MiniPanelPillProps {
  lang: Lang;
  /**
   * The body's shape, 0 → 1: the resting 6 × 44 pt pill at 0, the 44 × 96 pt invite capsule a drag
   * opens at 0.5, the 184 × 112 pt "Drop to add as context" card at 1. Drive it with a spring; the
   * card's glyph and text fade in over the last quarter.
   */
  swell?: number | undefined;
  /**
   * The liquid reach toward the pointer: `x` and `y` point from the body to it (any length), and
   * `amount` (0 → 1) is how hard it pulls. The body stretches along that line up to 8% (the
   * shell's velocity stretch), narrows across it, and reaches up to 14 pt toward it.
   */
  stretch?: { x: number; y: number; amount: number } | undefined;
  /**
   * Seconds since a drop landed: the card squashes in 0.1 s (92% along the edge, 106% across it),
   * then springs back (0.35 s, bounce 0.5), as `MiniPanelChoreography.absorb*`.
   */
  absorb?: number | undefined;
}

/** The squash of a drop being taken in, as [across, along] scale factors. */
function squash(absorb: number | undefined): [number, number] {
  if (absorb === undefined || absorb < 0) return [1, 1];
  if (absorb < 0.1) {
    const k = easeOut(absorb / 0.1);
    return [1 + 0.06 * k, 1 - 0.08 * k];
  }
  const back = springAt(absorb, 0.1, { response: 0.35, damping: 0.5 });
  return [1.06 - 0.06 * back, 0.92 + 0.08 * back];
}

/**
 * The mini panel's body on the right screen edge (`MiniPanelView`): one glass shape that morphs
 * from the resting pill to the invite capsule to the drop card, reaching toward a dragged file.
 * Its box is 200 × 140 pt; its right edge is the work area's edge and its vertical middle the
 * pill's middle, so place it with that box.
 */
export function MiniPanelPill({ lang, swell = 0, stretch, absorb }: MiniPanelPillProps) {
  const first = Math.min(1, swell * 2);
  const second = Math.max(0, swell * 2 - 1);
  const pick = (index: 0 | 1 | 2) =>
    swell <= 0.5
      ? mix(PILL[index], INVITE[index], first)
      : mix(INVITE[index], TARGET[index], second);
  const thickness = pick(0);
  const length = pick(1);
  const inset = pick(2);
  const radius = Math.min(thickness / 2, mix(thickness / 2, CARD_RADIUS, second));
  const [across, along] = squash(absorb);
  const pull = stretch?.amount ?? 0;
  const span = stretch ? Math.hypot(stretch.x, stretch.y) : 0;
  const ux = span > 0 && stretch ? stretch.x / span : 0;
  const uy = span > 0 && stretch ? stretch.y / span : 0;
  const share = ux * ux;
  const sx = 1 + pull * (0.08 * share - 0.04 * (1 - share));
  const sy = 1 + pull * (0.08 * (1 - share) - 0.04 * share);
  return (
    <div className="pk-mini">
      <div
        className="glass pk-mini__body"
        style={{
          '--thick': thickness,
          '--long': length,
          '--inset': inset,
          '--radius': radius,
          '--sx': sx * across,
          '--sy': sy * along,
          '--reach-x': ux * pull * 14,
          '--reach-y': uy * pull * 14,
        }}
      >
        <div className="pk-mini__drop" style={{ '--show': smoothstep(0.78, 1, swell) }}>
          <FilePlus className="pk-icon" />
          <span>{strings[lang].composer.drop}</span>
        </div>
      </div>
    </div>
  );
}
