// Draws the installer window's background in the website's faceplate language (apps/website, see
// its README and styles/base.css): a dark plate perforated with a 24 pt dot grid, a black LED
// display set into it whose lit dots point from the app to Applications, and a lower legend plate
// joined to it by a seam with registration crosses, carrying the build's readout in dot-matrix
// figures.
//
// Finder draws icon labels in the system appearance's text color (white in Dark Mode, black in
// Light Mode) whatever the picture behind them, so the legend plate under the labels is a mid gray
// that keeps both colors at about 4.5:1. The upper plate holds only the icons and the display.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Window geometry shared with settings.py: content size, icon size and icon centers in points. */
export const layout = JSON.parse(readFileSync(new URL('layout.json', import.meta.url), 'utf8'));

// The website's tokens (styles/tokens.css): the faceplate, the display glass, hairlines and dots.
const PLATE = '#0b0b0c';
const GLASS = '#000';
// Hairlines are white at the given opacity: CoreSVG, which rasterizes this, reads no CSS color
// alpha, so every translucent fill is a color plus an opacity.
const LINE_1 = 0.09;
const LINE_2 = 0.14;
const GRID = 24;
const LED = 8;
// Mid gray (relative luminance ~0.18): white and black label text both reach ~4.5:1 on it.
const LEGEND = '#767676';
const ENGRAVED = '#2a2a2c';
// Finder's icon view keeps its content taller than the 288 pt window (578 pt for these icons,
// whatever the window's height), so the window can scroll. The legend plate runs on below the
// window by this much, so scrolling reveals more plate rather than Finder's blank fill.
const OVERSCROLL = 320;

// The display's picture, top row first: `x` is a lit LED. The tail fades in like a trail.
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
function perforations(top, bottom, fill, opacity) {
  const dots = [];
  for (let y = GRID / 2; y < bottom; y += GRID) {
    if (y < top) continue;
    for (let x = GRID / 2; x < layout.width; x += GRID) dots.push(dot(x, y, 1.25, fill, opacity));
  }
  return dots.join('');
}

/** The display between the two icons: black glass, a hairline bezel, unlit and lit LEDs. */
function display() {
  const cols = ARROW[0].length;
  const w = cols * LED;
  const h = ARROW.length * LED;
  const x = (layout.app.x + layout.applications.x) / 2 - w / 2;
  const y = layout.app.y - h / 2;
  const leds = ARROW.flatMap((row, j) =>
    Array.from(row, (cell, i) => {
      const cx = x + LED / 2 + i * LED;
      const cy = y + LED / 2 + j * LED;
      if (cell !== 'x') return dot(cx, cy, 1.1, '#fff', 0.07);
      const opacity = TRAIL[i] ?? 1;
      // A faint halo stands in for the website's LED glow (`.led`'s box-shadow).
      return dot(cx, cy, 4.5, '#fff', 0.12 * opacity) + dot(cx, cy, LED * 0.34, '#fff', opacity);
    }),
  );
  return [
    `<rect x="${x}" y="${y + 1}" width="${w}" height="${h}" rx="16" fill="#fff" fill-opacity="0.05"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${GLASS}"/>`,
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="15.5" fill="none" stroke="#fff" stroke-opacity="${LINE_1}"/>`,
    ...leds,
  ].join('');
}

/** A registration cross centered on (x, y), as on the website's seams. */
const cross = (x, y) =>
  `<rect x="${x - 5}" y="${y}" width="11" height="1" fill="#fff" fill-opacity="${LINE_2}"/>` +
  `<rect x="${x}" y="${y - 5}" width="1" height="11" fill="#fff" fill-opacity="${LINE_2}"/>`;

/** The readout engraved in the legend plate, centered on (cx, cy) at a 2 pt dot pitch. */
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
              ? dot(left + (g * 6 + i + 0.5) * pitch, top + (j + 0.5) * pitch, 0.75, ENGRAVED)
              : '',
          ),
        ),
    )
    .join('');
}

/** The background as SVG, in points; `version` is the app version the readout names. */
export function backgroundSvg(version) {
  const { width, height, iconSize, app } = layout;
  // The seam runs just above the bottom of the icon cell: below the artwork, which macOS insets
  // within the cell, and above the label Finder draws under the cell.
  const seam = app.y + iconSize / 2 - 4;
  // The readout sits midway between the labels' line and the window's bottom edge.
  const readoutY = Math.round((seam + 24 + height) / 2);
  const imageHeight = height + OVERSCROLL;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${imageHeight}" viewBox="0 0 ${width} ${imageHeight}">`,
    `<rect width="${width}" height="${seam}" fill="${PLATE}"/>`,
    perforations(0, seam, '#fff', 0.1),
    `<rect y="${seam}" width="${width}" height="${imageHeight - seam}" fill="${LEGEND}"/>`,
    perforations(seam + GRID / 2, imageHeight, '#000', 0.07),
    `<rect y="${seam}" width="${width}" height="1" fill="#fff" fill-opacity="0.18"/>`,
    cross(2 * GRID, seam),
    cross(width - 2 * GRID, seam),
    display(),
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
