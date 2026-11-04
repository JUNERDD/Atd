/**
 * Every surface value the panel background setting implies, from one function per consumer, so
 * the page's fill and text, the code block, and the shell's floating glass cannot drift apart. The
 * page applies `panelSurface` per appearance; the shell takes `nativePanelBackground` through
 * `panelBackground.set` and draws its own glass from it.
 */
import {
  DEFAULT_PANEL_BACKGROUND,
  type PanelBackground,
  type PanelTint,
} from '@atd/agent-contracts';
import type { PostParams } from '../../native-bridge/client';
import {
  CODE_WELL,
  FLOATING_SHOW_THROUGH,
  FLOATING_WASH_BASE,
  RAISED_WASH,
  READABLE_FLOORS,
  SECONDARY_TEXT,
  TRANSPARENCY_LIMITS,
  type Theme,
} from './measured';

export type { Theme } from './measured';
type Rgb = [number, number, number];

/** The macOS default accent (blue), which `accent` takes until the shell reports the user's. */
export const DEFAULT_ACCENT_COLOR = '#007aff';

/** Hue and chroma per tint; lightness stays the tone's, so text contrast barely moves. */
const TINTS: Record<Exclude<PanelTint, 'accent'>, { hue: number; chroma: number }> = {
  neutral: { hue: 0, chroma: 0 },
  graphite: { hue: 255, chroma: 0.012 },
  blue: { hue: 255, chroma: 0.05 },
  purple: { hue: 300, chroma: 0.05 },
  green: { hue: 155, chroma: 0.04 },
  sand: { hue: 75, chroma: 0.035 },
  rose: { hue: 10, chroma: 0.045 },
};
const ACCENT_CHROMA = 0.05;

const toLinear = (channel: number) => {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) =>
  Math.round(
    Math.min(255, Math.max(0, 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))),
  );

/** OKLCH to sRGB, clipped into gamut. */
function oklchRgb(l: number, c: number, hue: number): Rgb {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    fromLinear(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    fromLinear(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  ];
}

/** The OKLCH hue of an sRGB `#rrggbb`. */
function oklchHue(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363015719 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

function parseHex(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const rgbCss = ([r, g, b]: Rgb, opacity: number) =>
  opacity >= 100 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${opacity}%)`;

function tintSpec(tint: PanelTint, accentColor: string) {
  return tint === 'accent' ? { hue: oklchHue(accentColor), chroma: ACCENT_CHROMA } : TINTS[tint];
}

/** The fill's color: the tone's gray, or its OKLab lightness at the tint's hue. */
export function fillColor(theme: Theme, background: PanelBackground, accentColor: string): Rgb {
  const level = background.tone[theme];
  const { hue, chroma } = tintSpec(background.tint, accentColor);
  if (chroma === 0) return [level, level, level];
  // Light surfaces carry half the chroma, or the tint reads as a colored page.
  return oklchRgb(Math.cbrt(toLinear(level)), theme === 'dark' ? chroma : chroma / 2, hue);
}

/** A swatch for a tint's identity: the hue itself, not the very dark or very light fill. */
export function tintSwatch(tint: PanelTint, accentColor: string): string {
  const { hue, chroma } = tintSpec(tint, accentColor);
  return chroma === 0 ? '#8e8e93' : `oklch(0.62 ${Math.min(chroma * 3, 0.15)} ${hue})`;
}

/** Linear between the rows' levels, along the nearest segment beyond them; within 0–100. */
function interpolate(rows: number[][], level: number): number[] {
  const above = rows.findIndex(([at = 0]) => at >= level);
  const upper = above === -1 ? rows.length - 1 : Math.max(1, above);
  const [l0 = 0, ...a] = rows[upper - 1] ?? [];
  const [l1 = 0, ...b] = rows[upper] ?? [];
  const k = l1 === l0 ? 0 : (level - l0) / (l1 - l0);
  return a.map((v, i) => Math.min(100, Math.max(0, v + k * ((b[i] ?? v) - v))));
}

export interface OpacityLimits {
  /** The lowest fill opacity keeping secondary text at 4.6:1 over every measured backdrop. */
  readable: number;
  /** The lowest keeping it at 3:1: the most transparent the panel goes. */
  minimum: number;
  /** The thinnest code well keeping every syntax color at 4.6:1 at the readable floor. */
  codeWell: number;
}

/** The fill opacity thresholds for this appearance's tone and the glass variant. */
export function opacityLimits(theme: Theme, background: PanelBackground): OpacityLimits {
  const level = background.tone[theme];
  const [readable = 100, codeWell = 100] = interpolate(
    READABLE_FLOORS[background.glass][theme],
    level,
  );
  const [minimum = 100] = interpolate(TRANSPARENCY_LIMITS[background.glass][theme], level);
  return {
    readable: Math.ceil(readable),
    minimum: Math.ceil(minimum),
    codeWell: Math.ceil(codeWell),
  };
}

/** The fill opacity the panel shows: the chosen one, or the 3:1 limit when the tone needs more. */
export function shownOpacity(theme: Theme, background: PanelBackground): number {
  return Math.max(background.opacity[theme], opacityLimits(theme, background).minimum);
}

/**
 * The factor for the floating surfaces' vibrant field and selection washes at a fill opacity: they
 * lift the glass by a fixed amount while a thinner fill lets more desktop through, so they scale
 * by the desktop's share over the fill they were tuned at. Never below 1; one decimal.
 */
export function washScale(theme: Theme, opacity: number): number {
  const points = FLOATING_SHOW_THROUGH[theme];
  const base = interpolate(points, FLOATING_WASH_BASE)[0] ?? 1;
  const shown = interpolate(points, Math.max(points[0]?.[0] ?? 0, opacity))[0] ?? base;
  return Math.max(1, Math.round((shown / base) * 10) / 10);
}

export interface PanelSurface {
  /** The fill's sRGB color, which Reduce Transparency shows opaque. */
  color: Rgb;
  /** `color` as `#rrggbb`. */
  hex: string;
  /** The fill opacity shown, 0–100 (`shownOpacity`). */
  opacity: number;
  /** The panel fill as CSS (`--ata-surface-panel`). */
  fill: string;
  /** The opaque fill as CSS, for Reduce Transparency. */
  opaqueFill: string;
  /** Secondary text and icons over the fill (`--ata-text-secondary`, `--muted-foreground`). */
  secondaryText: string;
  /** The user bubble's and table header's raised wash (`--muted` on the panel). */
  raised: string;
  /** The code block's well: as thin as its syntax colors allow at the readable floor, thickening
   * to opaque as the panel does. */
  codeSurface: string;
  /** The floating surfaces' wash factor (`washScale`). */
  washScale: number;
}

/** The panel's surface in one appearance for this setting. */
export function panelSurface(
  theme: Theme,
  background: PanelBackground,
  accentColor: string,
): PanelSurface {
  const limits = opacityLimits(theme, background);
  const opacity = shownOpacity(theme, background);
  const solidity =
    limits.readable >= 100 ? 1 : Math.max(0, (opacity - limits.readable) / (100 - limits.readable));
  const well = Math.round(limits.codeWell + solidity * (100 - limits.codeWell));
  const color = fillColor(theme, background, accentColor);
  return {
    color,
    hex: toHex(color),
    opacity,
    fill: rgbCss(color, opacity),
    opaqueFill: rgbCss(color, 100),
    secondaryText: SECONDARY_TEXT[theme],
    raised: RAISED_WASH[theme],
    codeSurface: rgbCss(CODE_WELL[theme], well),
    washScale: washScale(theme, opacity),
  };
}

/** What the shell draws its own glass from (`panelBackground.set`). */
export function nativePanelBackground(
  background: PanelBackground,
  accentColor: string,
): PostParams<'panelBackground.set'> {
  const fill = (theme: Theme) => {
    const surface = panelSurface(theme, background, accentColor);
    const [red, green, blue] = surface.color;
    return { red, green, blue, alpha: surface.opacity / 100, washScale: surface.washScale };
  };
  return {
    dark: fill('dark'),
    light: fill('light'),
    glass: background.glass,
    blur: background.blur,
    refractionWidth: background.refractionWidth,
    refractionStrength: background.refractionStrength,
  };
}

/** Whether the setting is the measured recipe throughout. */
export function isDefaultPanelBackground(background: PanelBackground): boolean {
  return JSON.stringify(background) === JSON.stringify(DEFAULT_PANEL_BACKGROUND);
}
