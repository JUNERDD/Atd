# Atd brand assets

The Atd mark, Drops, is a flat abstract symbol: two teardrops meeting point to point on the
diagonal. It is solid, has no letters and no container, and its full silhouette stays visible at
every size.

- `symbol.svg` is the master: the mark's two paths in an 84 × 84 box. Edit only this file.
- Every PNG is exported from it by `node scripts/export-brand.mjs` (needs `rsvg-convert`): the files
  here, `AppIcon.appiconset`, `AppIconDev.appiconset` and the eight menu bar `*Template` image sets
  in `apps/macos/App/Assets.xcassets`, and the website's `brand/atd-symbol.png`, `favicon.png`,
  `icon-192.png` and `apple-touch-icon.png`. Do not edit the PNGs by hand.
- `symbol.png`: 1254 × 1254 transparent; the mark fills the middle 58%. Keep its padding; do not
  stretch it or use a cover crop.
- `app-icon.png`: 1024 × 1024 transparent. The off-white (`#f5f5f4`) tile is 864 × 864 with a 190px
  radius and an 80px outer margin; the mark is 400px, centered.

## Application use

The panel uses the symbol as a `currentColor` alpha mask. A 26px image footprint keeps the visible
mark about 15px wide inside the existing 28px button, with the complete source and padding intact.
The website's nav shows it the same way at 24px. Settings navigation has no logo.

Window-level loading (the panel and settings windows while their code loads, and the panel while
the service starts) animates the mark's two drops twining around each other (`BrandLoader` in
`apps/desktop/src/components/brand-loader.tsx`). They orbit their shared centre on a circle tilted
away from the screen, so each in turn passes in front of the other, growing as it comes forward
while the one behind shrinks and fades, and they pass back through the mark between crossings. The
point symmetry re-forms the mark every half orbit, so each half orbit reads as a turn. Each cycle
is three of them: the drops speed up out of the mark, rush through the middle turn and slow into
the mark again; the speed eases but never stops. The animation runs two cycles, which brings each
drop back to its own place. The rhythm is computed rather than tuned: the speed is one harmonic of
the cycle, the gentlest way a loop can speed up and slow down, between the fastest top speed at
which the spin cannot strobe and the fastest slow speed that keeps the mark readable, with every
frame moving. `apps/desktop/scripts/brand-loader-motion.mjs` derives it and bakes it into
transform and opacity keyframes the compositor plays (run
`pnpm --filter @atd/desktop brand-loader-motion` after changing it; `--stats` prints the figures).
It writes the same keyframes into Swift for the macOS shell, whose native placeholder
(`BrandLoaderView`) shows the loader until a window's page paints. The generator reads the drops'
radius from `symbol.svg` and draws each drop's mask from it, so the master stays the only source of
the geometry. The mark is 32px inside a 40px box that leaves room
for a drop swelling as it comes forward. Under Reduce Motion it rests whole and breathes its
opacity instead. Inline and in-control progress keeps the Lucide spinner.

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
`App / Brand loader` (`4451:96668`) draws the loader's phases from the same paths and plays the loop
as a prototype; `App / Window loading` (`4452:96602`) places it in the window-level loading state.
