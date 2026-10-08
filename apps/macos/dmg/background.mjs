// Draws a light installer background with a subtle 24 pt dot grid, a dot-matrix arrow pointing
// from the app to Applications, and a build readout. Finder's native black labels stay readable
// directly on the background. A short English instruction sits below the arrow.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Window geometry shared with settings.py: content size, icon size and icon centers in points. */
export const layout = JSON.parse(readFileSync(new URL('layout.json', import.meta.url), 'utf8'));

const SURFACE = '#f5f5f7';
const INK = '#323235';
const GRID = 24;
const LED = 8;
const READOUT = '#6e6e73';
// Finder's icon view keeps its content taller than the 288 pt window (578 pt for these icons,
// whatever the window's height), so the window can scroll. Extend the surface below the window
// to keep the background continuous when scrolling.
const OVERSCROLL = 320;

// The arrow, top row first: `x` is a lit LED. The tail fades in like a trail.
const ARROW = [
  '....................',
  '............x.......',
  '.............x......',
  '..............x.....',
  '....xxxxxxxxxxxx....',
  '..............x.....',
  '.............x......',
  '............x.......',
  '....................',
];
const TRAIL = { 4: 0.25, 5: 0.45, 6: 0.7 };

// 5 × 7 dot-matrix figures for the readout; `1` is a dot, rows top first.
const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 00000 00100',
  '-': '00000 00000 00000 01110 00000 00000 00000',
  '·': '00000 00000 00000 00100 00000 00000 00000',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

const dot = (x, y, r, fill, opacity = 1) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" fill-opacity="${opacity}"/>`;

/** Perforations at the 24 pt pitch, registered so the window edges fall between dots. */
function perforations(height) {
  const dots = [];
  for (let y = GRID / 2; y < height; y += GRID) {
    for (let x = GRID / 2; x < layout.width; x += GRID) dots.push(dot(x, y, 1.25, '#000', 0.06));
  }
  return dots.join('');
}

/** Lit arrow dots between the icons, directly on the window background. */
function arrow() {
  const cols = ARROW[0].length;
  const w = cols * LED;
  const h = ARROW.length * LED;
  const x = (layout.app.x + layout.applications.x) / 2 - w / 2;
  const y = layout.app.y - h / 2;
  const leds = ARROW.flatMap((row, j) =>
    Array.from(row, (cell, i) => {
      const cx = x + LED / 2 + i * LED;
      const cy = y + LED / 2 + j * LED;
      if (cell !== 'x') return '';
      const opacity = TRAIL[i] ?? 1;
      return dot(cx, cy, 4.5, INK, 0.08 * opacity) + dot(cx, cy, LED * 0.34, INK, opacity);
    }),
  );
  return leds.join('');
}

/** The build readout, centered on (cx, cy) at a 2 pt dot pitch. */
function readout(text, cx, cy) {
  const pitch = 2;
  const glyphs = [...text.toUpperCase()].map((c) => FONT[c] ?? FONT[' ']);
  const left = cx - (glyphs.length * 6 - 1) * (pitch / 2);
  const top = cy - 7 * (pitch / 2);
  return glyphs
    .flatMap((glyph, g) =>
      glyph
        .split(' ')
        .flatMap((row, j) =>
          Array.from(row, (bit, i) =>
            bit === '1'
              ? dot(left + (g * 6 + i + 0.5) * pitch, top + (j + 0.5) * pitch, 0.75, READOUT)
              : '',
          ),
        ),
    )
    .join('');
}

/** The background as SVG, in points; `version` is the app version the readout names. */
export function backgroundSvg(version) {
  const { width, height, iconSize, app } = layout;
  // The readout sits midway between the labels' line and the window's bottom edge.
  const readoutY = Math.round((app.y + iconSize / 2 + 20 + height) / 2);
  const imageHeight = height + OVERSCROLL;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${imageHeight}" viewBox="0 0 ${width} ${imageHeight}">`,
    `<rect width="${width}" height="${imageHeight}" fill="${SURFACE}"/>`,
    perforations(imageHeight),
    arrow(),
    `<text x="${width / 2}" y="${app.y + 50}" text-anchor="middle" font-family="Helvetica Neue, sans-serif" font-size="12" fill="#66666b">Drag to install</text>`,
    readout(`Atd · ${version} · arm64`, width / 2, readoutY),
    '</svg>',
  ].join('');
}

/**
 * Writes `background.png` and `background@2x.png` into `dir`, the pair dmgbuild combines into one
 * HiDPI TIFF. sips (ImageIO) rasterizes the SVG at each size, so the 2x image is drawn, not scaled.
 */
export function writeBackground(dir, version) {
  const svg = join(dir, 'background.svg');
  writeFileSync(svg, backgroundSvg(version));
  for (const scale of [1, 2]) {
    const name = scale === 1 ? 'background.png' : `background@${scale}x.png`;
    const size = [String((layout.height + OVERSCROLL) * scale), String(layout.width * scale)];
    execFileSync('sips', ['-s', 'format', 'png', '-z', ...size, svg, '--out', join(dir, name)], {
      stdio: 'ignore',
    });
  }
  rmSync(svg);
}
