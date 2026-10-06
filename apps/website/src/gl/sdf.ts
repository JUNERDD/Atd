/** Distances beyond this many cells are clamped; a change never needs to see further. */
const FAR = 24;
const INF = 1e20;

/**
 * One pass of the exact squared Euclidean distance transform (Felzenszwalb and Huttenlocher) over
 * `n` samples read from `values` at `start + i * stride`, written back in place. INF stands in for
 * infinity throughout, so every intersection stays a finite number.
 */
function transform1d(
  values: Float64Array,
  start: number,
  stride: number,
  n: number,
  scratch: Scratch,
): void {
  const { f, v, z, d } = scratch;
  for (let i = 0; i < n; i++) f[i] = values[start + i * stride] ?? INF;
  const meet = (q: number, p: number) =>
    ((f[q] ?? INF) + q * q - ((f[p] ?? INF) + p * p)) / (2 * q - 2 * p);
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k] ?? 0);
    while (s <= (z[k] ?? -INF)) {
      k -= 1;
      s = meet(q, v[k] ?? 0);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? INF) < q) k += 1;
    const p = v[k] ?? 0;
    d[q] = (q - p) * (q - p) + (f[p] ?? INF);
  }
  for (let i = 0; i < n; i++) values[start + i * stride] = d[i] ?? INF;
}

interface Scratch {
  f: Float64Array;
  v: Int32Array;
  z: Float64Array;
  d: Float64Array;
}

/** Squared distance from every cell to the nearest cell where `feature` holds. */
function distanceTo(feature: (index: number) => boolean, cols: number, rows: number): Float64Array {
  const grid = new Float64Array(cols * rows);
  for (let i = 0; i < grid.length; i++) grid[i] = feature(i) ? 0 : INF;
  const n = Math.max(cols, rows);
  const scratch: Scratch = {
    f: new Float64Array(n),
    v: new Int32Array(n),
    z: new Float64Array(n + 1),
    d: new Float64Array(n),
  };
  for (let col = 0; col < cols; col++) transform1d(grid, col, cols, rows, scratch);
  for (let row = 0; row < rows; row++) transform1d(grid, row * cols, 1, cols, scratch);
  return grid;
}

/**
 * A word's signed distance field on the grid, in cells: negative inside the letters, positive
 * outside. Cells the ink only partly covers carry `0.5 - coverage`, so the field's own lit test
 * (`clamp(0.5 - sdf, 0, 1)`) gives back exactly the coverage the word is drawn with at rest; full and
 * empty cells carry their distance to the nearest cell across the edge, less half a cell.
 */
export function signedDistance(coverage: Uint8Array, cols: number, rows: number): Float32Array {
  const inside = (index: number) => (coverage[index] ?? 0) >= 128;
  const toInside = distanceTo(inside, cols, rows);
  const toOutside = distanceTo((index) => !inside(index), cols, rows);
  const field = new Float32Array(cols * rows);
  for (let i = 0; i < field.length; i++) {
    const cover = (coverage[i] ?? 0) / 255;
    if (cover > 0.02 && cover < 0.98) {
      field[i] = 0.5 - cover;
    } else if (cover >= 0.98) {
      field[i] = -Math.min(FAR, Math.max(0.5, Math.sqrt(toOutside[i] ?? INF) - 0.5));
    } else {
      field[i] = Math.min(FAR, Math.max(0.5, Math.sqrt(toInside[i] ?? INF) - 0.5));
    }
  }
  return field;
}
