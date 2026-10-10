/**
 * The Atd mark's geometry, inlined from `packages/ui/src/assets/brands/atd/symbol.svg` (the
 * master; keep these paths identical to it). Two teardrops meet point to point at the box's center
 * on the top-left to bottom-right diagonal. Never draw them in a box that is not square.
 */
export const DROPS_VIEWBOX = '18 18 84 84';

/** The box's origin and side, in the master's units. */
export const DROPS_BOX = { origin: 18, size: 84 } as const;

/** The upper-left drop (its point at the center, aiming down-right) and the lower-right one. */
export const DROP_PATHS = {
  upper: 'M60 60H39A21 21 0 1 1 60 39Z',
  lower: 'M60 60H81A21 21 0 1 1 60 81Z',
} as const;

export type DropId = keyof typeof DROP_PATHS;

/** Each drop's centroid, in the master's units: the point it spins and scales about. */
export const DROP_CENTROIDS: Record<DropId, { x: number; y: number }> = {
  upper: { x: 40, y: 40 },
  lower: { x: 80, y: 80 },
};

/** A master-unit position as a percentage of the mark's box. */
export function boxPercent(value: number): number {
  return ((value - DROPS_BOX.origin) / DROPS_BOX.size) * 100;
}
