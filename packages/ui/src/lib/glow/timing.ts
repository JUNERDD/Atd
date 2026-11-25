/**
 * The light's bloom, exit and cyan-shift timing, in seconds. The exit, quick fade and cyan shift
 * match `waiting-glow.css` and the shell. The panel's entry blooms out of the composer, with a
 * shorter opacity fade; the shell's 0.4 fade relies on the HUD window's own entrance.
 */
export const GLOW_TIMING = {
  /**
   * The bloom has all but settled by this (99.4% of the spring). Opacity rises in 200 ms so the
   * light is already visible while the welcome and submitted draft leave.
   */
  entry: 0.8,
  /** The fade however the wait ends: after the reply's first output, or stopped or failed. */
  exit: 0.85,
  /** Every fade under Reduce Motion. */
  quick: 0.2,
  /** The cyan shift that marks the first output, before the light fades. */
  hue: 0.45,
} as const;

/** The cyan shift's hue rotation in degrees (`IslandGlowStyle.writingHue`). */
export const GLOW_DONE_HUE = -28;

/**
 * The light's strength, as the shell's `IslandWorkingGlow` computes the HUD's: per appearance,
 * then reduced under Increase Contrast and Reduce Transparency. The shell's 0.34 in dark suits the
 * HUD's small capsule; over the whole dark panel its deep palette all but vanishes, so the panel's
 * band takes more of it.
 */
export const GLOW_STRENGTH = {
  light: 0.15,
  dark: 0.6,
  increasedContrast: 0.4,
  reducedTransparency: 0.6,
} as const;
