import { Img } from 'remotion';
import { clamp01, mix } from '../../motion/ease.ts';
import { springAt, type Spring } from '../../motion/spring.ts';
import type { Brand } from './brands.ts';

/** A ring's ellipse and motion, in world px and radians. */
export interface Ring {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Angular speed, radians per second (negative runs the other way). */
  speed: number;
  /** Where the first mark sits at t = 0. */
  phase: number;
  /** A mark's disc diameter at the ring's middle depth. */
  size: number;
}

interface OrbitProps {
  t: number;
  ring: Ring;
  brands: readonly Brand[];
  /** When the marks start to orbit in, one after another. */
  enter: number;
  /**
   * 0 → 1: the ring lights up, its marks from dim and grey to full color and its line to light.
   * Omit for a ring that is simply shown.
   */
  lit?: number;
  /** When each mark's lighting pops; omit for none. */
  litAt?: number;
  /** The half of the ring this layer draws: behind the center mark or in front of it. */
  layer: 'back' | 'front';
}

/** The orbit-in: a long, slightly springy settle. */
const ARRIVE: Spring = { response: 1.05, damping: 0.86 };
const POP: Spring = { response: 0.36, damping: 0.5 };

/**
 * One ring of provider marks in a tilted orbit about the center: each mark swirls in from far
 * out, then circles on the ellipse, larger and sharper in front, smaller and softer behind. Two
 * layers (back and front) let the center mark sit between the ring's halves.
 */
export function Orbit({ t, ring, brands, enter, lit, litAt, layer }: OrbitProps) {
  const { cx, cy, rx, ry } = ring;
  const draw = clamp01((t - enter) / 1.1);
  const half =
    layer === 'back'
      ? `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`
      : `M ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy}`;
  return (
    <div
      className="orbit"
      data-layer={layer}
      data-lights={lit === undefined ? undefined : ''}
      style={{ '--lit': lit ?? 0 }}
    >
      <svg className="orbit__path" aria-hidden="true">
        <path d={half} pathLength={1} style={{ '--draw': draw }} />
      </svg>
      {brands.map((brand, index) => {
        const p = springAt(t, enter + index * 0.05, ARRIVE);
        const angle =
          ring.phase + (index / brands.length) * Math.PI * 2 + ring.speed * t - (1 - p) * 1.5;
        const depth = Math.sin(angle);
        if (depth >= 0 !== (layer === 'front')) return null;
        const reach = mix(2.3, 1, p);
        const pop = litAt === undefined ? 0 : springAt(t, litAt + index * 0.07, POP);
        const bump = litAt === undefined ? 0 : Math.sin(Math.PI * clamp01(pop)) * 0.18;
        return (
          <div
            key={brand.name}
            className="orbit__mark glass"
            data-ink={brand.ink ? '' : undefined}
            style={{
              '--x': cx + rx * reach * Math.cos(angle),
              '--y': cy + ry * reach * depth,
              '--size': `${ring.size}px`,
              '--s': (0.8 + 0.24 * depth) * mix(0.55, 1, p) * (1 + bump),
              '--o': clamp01(p * 2) * mix(0.5, 1, (depth + 1) / 2) * mix(0.4, 1, lit ?? 1),
              '--blur': `${(1 - depth) * 1.1 + (1 - clamp01(p)) * 10}px`,
            }}
          >
            <Img className="orbit__img" src={brand.src} />
          </div>
        );
      })}
    </div>
  );
}
