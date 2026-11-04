/**
 * What the panel background is derived from, measured on the composited screen (macOS 26.4): a
 * probe window built like the panel, over eight solid backdrops (white, black, gray, yellow, cyan,
 * blue, red, green), captured at each fill, tone and glass variant. Secondary text is the limiting
 * color, so every threshold is its worst contrast over the eight. Rows are `[level, ...values]`
 * along the fill's gray level; between rows the values interpolate, beyond them the nearest segment
 * extends (`interpolate` in `derive.ts`).
 */
import type { PanelGlassVariant } from '@atd/agent-contracts';

export type Theme = 'dark' | 'light';

/**
 * The readable floor per variant and tone, `[level, fill %, code well %]`: the lowest fill that
 * keeps the recipe's secondary text at 4.6:1 (4.5:1 plus the variation between two sweeps), and
 * the thinnest code well whose syntax colors keep 4.6:1 over it. The defaults sit at it. Clear
 * glass needs far more fill: at its floor it shows about as much desktop as regular at its own,
 * only less blurred. Light 248's regular floor is an upper bound (its 40–50% captures were stale).
 */
export const READABLE_FLOORS: Record<PanelGlassVariant, Record<Theme, number[][]>> = {
  regular: {
    dark: [
      [16, 53, 25],
      [24, 59, 25],
      [32, 66, 26],
      [40, 75, 26],
      [48, 89, 26],
    ],
    light: [
      [236, 69, 64],
      [248, 60, 62],
      [255, 52, 64],
    ],
  },
  clear: {
    dark: [
      [16, 84, 28],
      [24, 87, 27],
      [32, 91, 26],
      [40, 94, 27],
      [48, 97, 27],
    ],
    light: [
      [236, 92, 64],
      [242, 90, 64],
      [248, 87, 64],
      [255, 85, 64],
    ],
  },
};

/**
 * The outer limit per variant and tone, `[level, fill %]`: the lowest fill that keeps secondary
 * text at 3:1 (WCAG's floor for large text and interface graphics), the most transparent the
 * setting goes. Clear's are measured. Regular's blend the fill over the bare glass measured at 0%
 * fill, which matches every light measurement within 0.17:1 and dark's near these fills (dark 24:
 * 22% modeled, 21% measured). Light's bare glass alone keeps 3.3:1, so light can be fully clear.
 */
export const TRANSPARENCY_LIMITS: Record<PanelGlassVariant, Record<Theme, number[][]>> = {
  regular: {
    dark: [
      [0, 18],
      [8, 19],
      [16, 20],
      [24, 22],
      [32, 24],
      [40, 26],
      [48, 28],
      [56, 31],
      [64, 36],
    ],
    light: [
      [224, 0],
      [255, 0],
    ],
  },
  clear: {
    dark: [
      [16, 74],
      [24, 76],
      [32, 80],
      [40, 82],
      [48, 85],
    ],
    light: [
      [236, 69],
      [242, 67],
      [248, 66],
      [255, 64],
    ],
  },
};

/**
 * How much desktop the shell's floating SwiftUI glass (mini panel, command HUD) shows at a fill
 * opacity, `[fill %, white minus black backdrop]`, at the default tones. The floating surfaces'
 * vibrant washes scale by its share over the 80% fill they were tuned at (`washScale` in
 * `derive.ts`).
 */
export const FLOATING_SHOW_THROUGH: Record<Theme, number[][]> = {
  dark: [
    [50, 50],
    [55, 46],
    [60, 42],
    [65, 37],
    [70, 32],
    [75, 27],
    [80, 21],
    [100, 0],
  ],
  light: [
    [50, 29],
    [56, 25],
    [60, 22],
    [65, 20],
    [70, 17],
    [75, 14],
    [80, 11],
    [100, 0],
  ],
};

/** The fill opacity the floating washes were tuned at (the fill before the measured recipe). */
export const FLOATING_WASH_BASE = 80;

/** Secondary text over the translucent fill; the preset's #a1a1a1 and #737373 fail over it. */
export const SECONDARY_TEXT: Record<Theme, string> = { dark: '#b4b4b4', light: '#636363' };

/**
 * The raised wash of the user bubble and table header, translucent over the panel: it keeps primary
 * text at 7:1 or more, where the opaque `--muted` read as a slab on the lighter fill.
 */
export const RAISED_WASH: Record<Theme, string> = {
  dark: 'rgb(255 255 255 / 8%)',
  light: 'rgb(0 0 0 / 5%)',
};

/** The code theme's own background, which the code well lays over the panel at some opacity. */
export const CODE_WELL: Record<Theme, [number, number, number]> = {
  dark: [10, 10, 10],
  light: [255, 255, 255],
};

/**
 * Syntax colors the translucent well needs: the code theme's colors that fall under 4.5:1 over the
 * thin well, moved in lightness only, hue kept. Keys are the theme's values as pierre writes them
 * inline (`--diffs-token-dark:#9D6AFB`), upper case.
 */
export const CODE_PALETTE: Record<Theme, Record<string, string>> = {
  dark: { '#9D6AFB': '#b896ff', '#636363': '#a0a0a0' },
  light: { '#D47628': '#a8571a', '#08C0EF': '#00789a', '#18A46C': '#0f7a4f', '#636363': '#5e5e5e' },
};
/** The code block's line numbers over the translucent well. */
export const CODE_LINE_NUMBER: Record<Theme, string> = { dark: '#a8a8a8', light: '#575757' };
