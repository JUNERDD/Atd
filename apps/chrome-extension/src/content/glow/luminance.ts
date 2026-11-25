import { insideOwnLayer } from '../hosts.ts';

/** Eight points along the tab's edges, as fractions of the viewport, where the band falls. */
const POINTS: readonly (readonly [number, number])[] = [
  [0.02, 0.03],
  [0.5, 0.03],
  [0.98, 0.03],
  [0.02, 0.5],
  [0.98, 0.5],
  [0.02, 0.97],
  [0.5, 0.97],
  [0.98, 0.97],
];

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * A computed background colour as 0…255 sRGB and alpha. Chrome serializes sRGB colours as
 * `rgb()`/`rgba()` and keeps `color(srgb …)`; other spaces (lab, oklch, p3) are skipped, and the
 * walk looks further up.
 */
function parseColor(value: string): [number, number, number, number] | null {
  const legacy = /^rgba?\(([^)]+)\)/.exec(value);
  const modern = /^color\(srgb ([^)]+)\)/.exec(value);
  const body = legacy?.[1] ?? modern?.[1];
  if (!body) return null;
  const [r = 0, g = 0, b = 0, a = 1] = body
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return modern ? [r * 255, g * 255, b * 255, a] : [r, g, b, a];
}

/** The first mostly opaque background colour at or above `element`, as relative luminance. */
function backgroundLuminance(element: Element): number | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (!color) continue;
    const [r, g, b, a] = color;
    if (a > 0.5) return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  }
  return null;
}

/**
 * The page's own brightness where the band falls: the first mostly opaque background under eight
 * points along the viewport's edges, as relative luminance, taking the median so an image or a
 * coloured button at the edge doesn't decide it (the prototype's `samplePageLum`). A page with no
 * opaque background shows the canvas: dark only when the page asks for a dark colour scheme.
 * Computed locally; nothing leaves the page.
 */
export function samplePageLuminance(): number {
  const width = innerWidth;
  const height = innerHeight;
  const samples: number[] = [];
  for (const [fx, fy] of POINTS) {
    const element = document
      .elementsFromPoint(fx * width, fy * height)
      .find((candidate) => !insideOwnLayer(candidate));
    const luminance = element ? backgroundLuminance(element) : null;
    if (luminance !== null) samples.push(luminance);
  }
  if (samples.length === 0) {
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    return /^\s*dark\b/.test(scheme) ? 0.01 : 1;
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 1;
}
