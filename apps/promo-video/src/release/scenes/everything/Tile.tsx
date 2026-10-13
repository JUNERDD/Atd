import type { ReactNode } from 'react';
import { clamp01, easeOut, ramp } from '../../../motion/ease.ts';
import { springAt, type Spring } from '../../../motion/spring.ts';
import { DENSITY, type TileSpec, type Wall } from './layout.ts';

/** The pop a tile opens with: quick, with one soft overshoot. */
const POP: Spring = { response: 0.38, damping: 0.7 };
/** How long before its arrival a tile's seed dot swells, and how long a turn takes. */
export const SEED = 0.15;
const TURN = 0.15;

/** A tile's converge flight, in world px and fractions, from the scene. */
export interface Flight {
  dx: number;
  dy: number;
  scale: number;
  heat: number;
  opacity: number;
}

interface TileProps {
  spec: TileSpec;
  t: number;
  wall: Wall;
  /** Whether any of it is in frame: off-frame tiles draw their shell only. */
  visible: boolean;
  /** Times it turns over to new content (a brand tile's next mark). */
  turns?: readonly number[] | undefined;
  /** The completion glint's position over this tile, 0 → 1 (absent when not passing). */
  glint?: number | undefined;
  flight?: Flight | undefined;
  /** How lit its edge is, 0 → 1: the digits brighten as the camera pulls back so "0.8" reads. */
  lit?: number;
  /** The vignette, given how many turns have passed. */
  children: (turned: number) => ReactNode;
}

/**
 * One mosaic tile: it swells out of a dot of the grid a sixteenth before its arrival, then opens
 * like a card turning over, flaring white as it lands. Its vignette is laid out at `DENSITY`× and
 * shrunk, so close-ups stay crisp; a turn flips it edge-on and back with new content. During the
 * converge it flies along `flight`, shrinking and heating to coral.
 */
export function Tile({
  spec,
  t,
  wall,
  visible,
  turns = [],
  glint,
  flight,
  lit = 0,
  children,
}: TileProps) {
  const age = t - spec.arrive;
  const { rect } = spec;
  if (age < -SEED) return null;
  if (age < 0) {
    const grow = clamp01((age + SEED) / SEED);
    return (
      <i
        className="r08-every__seed"
        style={{
          '--ev-x': rect.x + rect.width / 2,
          '--ev-y': rect.y + rect.height / 2,
          '--ev-s': 3 + 15 * easeOut(grow),
          '--ev-o': grow,
        }}
      />
    );
  }
  const pop = springAt(t, spec.arrive, POP);
  const open = ramp(t, spec.arrive, 0.22);
  let turnScale = 1;
  let turnFlash = 0;
  let turned = 0;
  for (const at of turns) {
    if (t >= at) turned += 1;
    const u = (t - at + TURN) / (2 * TURN);
    if (u > 0 && u < 1) {
      turnScale = Math.abs(Math.cos(Math.PI * u));
      turnFlash = 0.35 * (1 - Math.abs(2 * u - 1));
    }
  }
  const scale = (0.18 + 0.82 * pop) * (flight?.scale ?? 1);
  const flash = 0.92 * Math.exp(-age / 0.09) + turnFlash;
  return (
    <div
      className="r08-every__tile"
      data-wall={wall}
      style={{
        '--ev-x': rect.x + (flight?.dx ?? 0),
        '--ev-y': rect.y + (flight?.dy ?? 0),
        '--ev-w': rect.width,
        '--ev-h': rect.height,
        '--ev-sx': scale * (0.08 + 0.92 * open) * turnScale,
        '--ev-sy': scale,
        '--ev-o': flight?.opacity ?? 1,
        '--ev-lit': lit,
      }}
    >
      {visible ? (
        <div
          className="r08-every__content"
          style={{
            '--ev-cw': rect.width * DENSITY,
            '--ev-ch': rect.height * DENSITY,
            '--ev-k': 1 / DENSITY,
            '--ev-in': ramp(t, spec.arrive + 0.03, 0.16),
          }}
        >
          {children(turned)}
        </div>
      ) : null}
      <i className="r08-every__rim" />
      {glint !== undefined ? <i className="r08-every__glint" style={{ '--ev-g': glint }} /> : null}
      {flash > 0.01 ? <i className="r08-every__flash" style={{ '--ev-f': flash }} /> : null}
      {flight && flight.heat > 0.01 ? (
        <i className="r08-every__heat" style={{ '--ev-heat': flight.heat }} />
      ) : null}
    </div>
  );
}
