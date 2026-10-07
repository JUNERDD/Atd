/**
 * The color math behind an app's page theme (`theme.ts`): `#RRGGBB` in and out, OKLCH to change a
 * color's lightness while keeping its hue, and WCAG 2 contrast to check the result. OKLab is Björn
 * Ottosson's (https://bottosson.github.io/posts/oklab/), the space of CSS `oklch()`; luminance and
 * contrast follow WCAG 2.2 (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance).
 */

/** A gamma-encoded sRGB color, each channel 0–1. */
export type Rgb = readonly [r: number, g: number, b: number];

/** An OKLCH color: perceptual lightness 0–1, chroma, and hue in radians. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const map = (color: Rgb, channel: (value: number) => number): Rgb => [
  channel(color[0]),
  channel(color[1]),
  channel(color[2]),
];
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const toLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const toEncoded = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

/** A `#RRGGBB` color, validated by the caller. */
export function parseHex(hex: string): Rgb {
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

/** The color as `#rrggbb`. */
export function toHex(color: Rgb): string {
  const byte = (value: number) =>
    Math.round(clamp01(value) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(color[0])}${byte(color[1])}${byte(color[2])}`;
}

/** The color rounded to the 8 bits per channel `toHex` writes, so checks see what the page gets. */
export function quantize(color: Rgb): Rgb {
  return map(color, (value) => Math.round(clamp01(value) * 255) / 255);
}

export function toOklch(color: Rgb): Oklch {
  const [r, g, b] = map(color, toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, bAxis),
    h: Math.atan2(bAxis, a),
  };
}

/** Linear sRGB of an OKLab color; channels outside 0–1 mean sRGB cannot show it. */
function oklabToLinear(lightness: number, a: number, b: number): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (color: Rgb) => color.every((value) => value >= -1e-7 && value <= 1 + 1e-7);

/**
 * The sRGB color at lightness `l` and hue `h` with as much of chroma `c` as sRGB can show: chroma
 * alone is reduced until every channel fits, as in CSS Color 4 gamut mapping, so the lightness the
 * caller picked and the hue stay put.
 */
export function fromOklch({ l, c, h }: Oklch): Rgb {
  const at = (chroma: number) => oklabToLinear(l, chroma * Math.cos(h), chroma * Math.sin(h));
  let fit = c;
  if (!inGamut(at(c))) {
    let low = 0;
    let high = c;
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2;
      if (inGamut(at(middle))) low = middle;
      else high = middle;
    }
    fit = low;
  }
  return map(at(fit), (value) => toEncoded(clamp01(value)));
}

/** WCAG 2 relative luminance. */
export function luminance(color: Rgb): number {
  const [r, g, b] = map(color, toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two colors, 1–21. */
export function contrast(first: Rgb, second: Rgb): number {
  const [a, b] = [luminance(first), luminance(second)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `top` at `alpha` over the opaque `bottom`, blended per gamma-encoded channel as browsers do. */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return [
    alpha * top[0] + (1 - alpha) * bottom[0],
    alpha * top[1] + (1 - alpha) * bottom[1],
    alpha * top[2] + (1 - alpha) * bottom[2],
  ];
}
