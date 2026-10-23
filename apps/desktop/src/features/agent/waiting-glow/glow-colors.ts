import type { ColorScheme } from '../../../theme/color-scheme';

type Rgb = readonly [number, number, number];

/** Deep, steel and mist for each appearance, as the shell blends them. */
export const GLOW_PALETTES: Record<ColorScheme, readonly [Rgb, Rgb, Rgb]> = {
  light: [
    [0.06, 0.86, 0.7],
    [0.08, 0.64, 1.0],
    [0.96, 1.0, 1.0],
  ],
  dark: [
    [0.035, 0.11, 0.17],
    [0.28, 0.51, 0.68],
    [0.68, 0.79, 0.88],
  ],
};

/**
 * Three unrelated smooth fields sampled on the mesh's rest grid, centered and normalized per
 * channel (`colorBases` in the shell). The light's colors are a moving blend of these.
 */
function colorBases(): Rgb[] {
  const samples = Array.from({ length: 24 }, (_, index): Rgb => {
    const x = (index % 6) / 5;
    const y = Math.floor(index / 6) / 3;
    return [
      Math.cos(Math.PI * x) * Math.cos(Math.PI * (y - 0.25)),
      Math.cos(Math.PI * y) * Math.cos(Math.PI * (x - 0.35)),
      0.6 * Math.cos(2 * Math.PI * x) * Math.sin(Math.PI * y) +
        0.4 * Math.sin(Math.PI * x) * Math.cos(Math.PI * (y + 0.2)),
    ];
  });
  const per = (fold: (channel: 0 | 1 | 2) => number): Rgb => [fold(0), fold(1), fold(2)];
  const mean = per((c) => samples.reduce((sum, s) => sum + s[c], 0) / samples.length);
  const centered = samples.map((s) => per((c) => s[c] - mean[c]));
  const scale = per((c) => centered.reduce((max, s) => Math.max(max, Math.abs(s[c])), 0));
  return centered.map((s) => per((c) => s[c] / scale[c]));
}

const BASES = colorBases();

/** The mesh colors depend on time alone; calculate the 24 colors once per draw, not per pixel. */
export function glowColors(phase: number, scheme: ColorScheme): number[][] {
  const theta = 0.35 + 2.4 * Math.sin(0.66 * phase) + 0.6 * Math.sin(0.37 * phase + 0.8);
  const phi = 0.25 + 0.55 * Math.sin(0.61 * phase + 1.6);
  const weights = [Math.cos(theta) * Math.cos(phi), Math.sin(theta) * Math.cos(phi), Math.sin(phi)];
  const values = BASES.map(
    (basis) => 0.65 * basis.reduce((sum, value, c) => sum + value * weights[c]!, 0),
  );
  const softened = values.map((value, i) => {
    const row = Math.floor(i / 6);
    const column = i % 6;
    let sum = value;
    let count = 1;
    for (const neighbour of [
      column > 0 ? i - 1 : -1,
      column < 5 ? i + 1 : -1,
      row > 0 ? i - 6 : -1,
      row < 3 ? i + 6 : -1,
    ]) {
      if (neighbour >= 0) {
        sum += values[neighbour]!;
        count++;
      }
    }
    return value + (sum / count - value) * ((0.5 / 1.5) * 0.32);
  });
  const mean = softened.reduce((sum, value) => sum + value, 0) / 24;
  const [deep, steel, mist] = GLOW_PALETTES[scheme];
  return softened.map((value) => {
    const tone = 0.5 + 0.47 * Math.tanh(1.7 * (value - mean));
    return deep.map(
      (channel, c) =>
        (1 - tone) ** 2 * channel + 2 * tone * (1 - tone) * steel[c]! + tone ** 2 * mist[c]!,
    );
  });
}
