#!/usr/bin/env node
/**
 * Exports every raster of the Atd mark from its vector master,
 * `packages/ui/src/assets/brands/atd/symbol.svg`: the padded symbol and the app icon (with their
 * development variants), both macOS app icon sets, the menu bar state images, and the website's
 * icons. Edit the master, never the PNGs, then run this again.
 *
 * Needs `rsvg-convert` (librsvg, `brew install librsvg`) on PATH; the DEV labels use the system's
 * Helvetica Neue Bold.
 *
 * Usage: node scripts/export-brand.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRAND = 'packages/ui/src/assets/brands/atd';
const ASSETS = 'apps/macos/App/Assets.xcassets';
const WEBSITE = 'apps/website/public';
const INK = '#111';

const master = readFileSync(`${BRAND}/symbol.svg`, 'utf8');
const [boxX, boxY, boxSize] = master
  .match(/viewBox="([^"]+)"/)[1]
  .split(/\s+/)
  .map(Number);
const shapes = [...master.matchAll(/<path\b[^>]*\/>/g)].map(([p]) =>
  p.replace(/\sfill="[^"]*"/, ''),
);

/** The mark's square box scaled to `size` and centered on (`cx`, `cy`). */
function mark(cx, cy, size, ink = INK) {
  const scale = size / boxSize;
  const at = `translate(${cx - size / 2} ${cy - size / 2}) scale(${scale}) translate(${-boxX} ${-boxY})`;
  return `<g fill="${ink}" transform="${at}">${shapes.join('')}</g>`;
}

const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

const work = mkdtempSync(join(tmpdir(), 'atd-brand-'));
let count = 0;
/** Renders `source` (drawn at its own size) to `out` at `width` × `height` pixels. */
function rasterize(source, out, width, height = width) {
  const file = join(work, `${count++}.svg`);
  writeFileSync(file, source);
  execFileSync('rsvg-convert', ['-w', String(width), '-h', String(height), '-o', out, file]);
}

// The padded symbol: panel and website masks show it with `contain`, so the padding sets the mark's
// visible size (15px of the panel's 26px footprint).
const SYMBOL_FILL = 0.58;
const symbol = svg(120, 120, mark(60, 60, 120 * SYMBOL_FILL));

// A DEV label: an outlined key of the mark's height beside it, in the ink's color.
const devLabel = (x, y, ink = INK) =>
  `<rect x="${x + 0.75}" y="${y + 0.75}" width="22.5" height="12.5" rx="3" fill="none" stroke="${ink}" stroke-width="1.5"/>` +
  `<text x="${x + 12}" y="${y + 10.6}" text-anchor="middle" font-family="Helvetica Neue" font-weight="700" font-size="10" fill="${ink}">DEV</text>`;

// App icon: the 864px off-white tile with an 80px transparent margin, the mark at 400px.
const TILE = `<rect x="80" y="80" width="864" height="864" rx="190" fill="#f5f5f4"/>`;
const appIcon = svg(1024, 1024, TILE + mark(512, 512, 400));
// Debug builds add an amber DEV badge whose bottom-right corner is concentric with the tile's,
// inset 56px from its right and bottom edges; it clears the mark by 16px.
const DEV_BADGE =
  `<path fill="#fbbf24" d="M626 728H862A26 26 0 0 1 888 754A134 134 0 0 1 754 888H626A26 26 0 0 1 600 862V754A26 26 0 0 1 626 728Z"/>` +
  `<text x="744" y="837" text-anchor="middle" font-family="Helvetica Neue" font-weight="700" font-size="86" fill="#1a1a1a">DEV</text>`;
const appIconDev = svg(1024, 1024, TILE + mark(512, 512, 400) + DEV_BADGE);

// Menu bar: 18pt template images, the mark 15pt wide. Running and attention put a badge in the
// mark's empty upper-right quadrant, cut clear of both drops; unavailable dims the mark to 40%, as
// the earlier exports did.
const MENU = { mark: 15, badge: [13.5, 4.5] };
function menuBody(state) {
  const base = mark(9, 9, MENU.mark);
  const [cx, cy] = MENU.badge;
  const cut = (r, badge) =>
    `<mask id="cut"><rect width="18" height="18" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#000"/></mask>` +
    `<g mask="url(#cut)">${base}</g>${badge}`;
  switch (state) {
    case 'idle':
      return base;
    case 'running':
      return cut(4.5, `<circle cx="${cx}" cy="${cy}" r="3.25" fill="${INK}"/>`);
    case 'attention':
      // A 4.25pt disc with an exclamation mark cut out of it.
      return cut(
        5.5,
        `<path fill="${INK}" fill-rule="evenodd" transform="translate(${cx} ${cy})" d="M0-4.25a4.25 4.25 0 1 1 0 8.5a4.25 4.25 0 1 1 0-8.5Z M-.65-2.15a.65 .65 0 0 1 1.3 0V.25a.65 .65 0 0 1-1.3 0Z M0 1.2a.75 .75 0 1 1 0 1.5a.75 .75 0 1 1 0-1.5Z"/>`,
      );
    case 'unavailable':
      return `<g opacity="0.4">${base}</g>`;
  }
}

const outputs = [
  [symbol, `${BRAND}/symbol.png`, 1254],
  [appIcon, `${BRAND}/app-icon.png`, 1024],
  [appIconDev, `${BRAND}/app-icon-dev.png`, 1024],
  // The panel's development logo: the 26px symbol footprint, then the label, shown at 54 × 26.
  [
    svg(54, 26, mark(13, 13, 26 * SYMBOL_FILL) + devLabel(28, 6)),
    `${BRAND}/symbol-dev.png`,
    108,
    52,
  ],
  [symbol, `${WEBSITE}/brand/atd-symbol.png`, 128],
  [appIcon, `${WEBSITE}/favicon.png`, 64],
  [appIcon, `${WEBSITE}/apple-touch-icon.png`, 180],
];

const ICON_SIZES = [16, 32, 128, 256, 512];
for (const [set, source] of [
  ['AppIcon', appIcon],
  ['AppIconDev', appIconDev],
]) {
  for (const size of ICON_SIZES) {
    outputs.push([source, `${ASSETS}/${set}.appiconset/icon_${size}x${size}.png`, size]);
    outputs.push([source, `${ASSETS}/${set}.appiconset/icon_${size}x${size}@2x.png`, size * 2]);
  }
}

for (const state of ['idle', 'running', 'attention', 'unavailable']) {
  const body = menuBody(state);
  const dev = state === 'unavailable' ? `<g opacity="0.4">${devLabel(20, 2)}</g>` : devLabel(20, 2);
  for (const [name, source, width] of [
    [`${state}Template`, svg(18, 18, body), 18],
    [`${state}DevTemplate`, svg(44, 18, body + dev), 44],
  ]) {
    const set = `${ASSETS}/${name}.imageset/${name}`;
    outputs.push([source, `${set}.png`, width, 18]);
    outputs.push([source, `${set}@2x.png`, width * 2, 36]);
  }
}

try {
  for (const [source, out, width, height] of outputs) rasterize(source, out, width, height);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Exported ${outputs.length} images.`);
