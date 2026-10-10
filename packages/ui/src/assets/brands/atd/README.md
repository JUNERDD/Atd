# Atd brand assets

The Atd mark, Drops, is a flat abstract symbol: two teardrops meeting point to point on the
diagonal. It is solid, has no letters and no container, and its full silhouette stays visible at
every size.

- `symbol.svg` is the master: the mark's two paths in an 84 × 84 box. Edit only this file.
- Every PNG is exported from it by `node scripts/export-brand.mjs` (needs `rsvg-convert`): the files
  here, `AppIcon.appiconset`, `AppIconDev.appiconset` and the eight menu bar `*Template` image sets
  in `apps/macos/App/Assets.xcassets`, and the website's `brand/atd-symbol.png`, `favicon.png` and
  `apple-touch-icon.png`. Do not edit the PNGs by hand.
- `symbol.png`: 1254 × 1254 transparent; the mark fills the middle 58%. Keep its padding; do not
  stretch it or use a cover crop.
- `app-icon.png`: 1024 × 1024 transparent. The off-white (`#f5f5f4`) tile is 864 × 864 with a 190px
  radius and an 80px outer margin; the mark is 400px, centered.

## Application use

The panel uses the symbol as a `currentColor` alpha mask. A 26px image footprint keeps the visible
mark about 15px wide inside the existing 28px button, with the complete source and padding intact.
The website's nav shows it the same way at 24px. Settings navigation has no logo.

The menu bar images are 18 × 18 template images (36 × 36 at 2x) with the mark 15pt wide. Running
and attention draw their badge in the mark's empty upper-right quadrant, centered at (13.5, 4.5),
cut clear of both drops; unavailable dims the mark to 40%.

## Development builds

- `app-icon-dev.png` adds an amber `DEV` badge for Debug builds: 288 × 160, inset 56px from the
  tile's right and bottom edges, its bottom-right corner concentric with the tile's. It clears the
  mark by 16px. `AppIconDev.appiconset` holds its native sizes; Release uses `AppIcon.appiconset`.
- `symbol-dev.png` is 108 × 52, displayed at 54 × 26 inside a 68 × 28 panel button when
  `import.meta.env.DEV` is true: the 26px symbol footprint, then an outlined `DEV` label (24 × 14).
- Debug menu images are 44 × 18 at 1x and 88 × 36 at 2x: each state's 18px image followed by the
  same `DEV` label. The native item uses variable width so neither part is squeezed.

## Figma

`App / Atd symbol` (`1741:95290`) holds the same vector at 58% of its 26 × 26 frame. The
foreground component (`1741:95292`), the app icons (`1741:95296`, development `1757:95728`), the
development panel header (`1760:95766`) and the menu bar states (`1562:59933`, development
`1759:95783`) all use it. When the mark changes, update the master and that component together.
