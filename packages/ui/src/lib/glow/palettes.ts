/**
 * The command HUD's light palettes, mirrored from the macOS shell's `IslandGlowPalette`
 * (`apps/macos/Sources/AIShell/Island/IslandGlowStyle.swift`); change both together. Shared by the
 * panel's waiting light (`apps/desktop`) and the tab light of Atd for Chrome.
 */

/** A linear RGB color, each channel 0…1. */
export type GlowRgb = readonly [number, number, number];

/** The deep, middle (steel) and highlight (mist) tones the light's field interpolates. */
export type GlowTones = readonly [GlowRgb, GlowRgb, GlowRgb];

export type GlowAppearance = 'light' | 'dark';

/**
 * `working`: the light while Atd works. `attention`: what it turns to while a task waits for the
 * person (a human-in-the-loop request).
 */
export const GLOW_PALETTES = {
  working: {
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
  },
  attention: {
    light: [
      [1.0, 0.5, 0.02],
      [1.0, 0.7, 0.2],
      [1.0, 0.97, 0.9],
    ],
    dark: [
      [0.36, 0.15, 0.02],
      [1.0, 0.58, 0.16],
      [1.0, 0.88, 0.64],
    ],
  },
} as const satisfies Record<string, Record<GlowAppearance, GlowTones>>;

export type GlowPalette = keyof typeof GLOW_PALETTES;

/**
 * How much stronger than the working light the shell draws the attention palette in its HUD
 * capsule (`IslandGlowPalette.emphasis`): warm tones over dark glass read as brown at the working
 * light's strength.
 */
export const GLOW_EMPHASIS: Record<GlowPalette, Record<GlowAppearance, number>> = {
  working: { light: 1, dark: 1 },
  attention: { light: 1.4, dark: 1.6 },
};
