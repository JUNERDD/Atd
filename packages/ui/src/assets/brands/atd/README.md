# Atd brand assets

The Atd mark is an abstract folded ribbon with complete rounded endpoints. Its full silhouette stays visible at every size.

- `symbol.png`: original 1254 × 1254 transparent PNG, created with the built-in image generator. Keep its transparent padding; do not stretch it or use a cover crop.
- `app-icon.png`: 1024 × 1024 transparent export of the Figma app-icon composition. The off-white tile is 864 × 864 with an 80px outer margin; the full symbol fits within it.
- Native size exports live in `apps/macos/App/Assets.xcassets/AppIcon.appiconset`. Menu bar images are exported from the four existing Figma status variants.

## Application use

The panel uses the symbol as a `currentColor` alpha mask. A 26px image footprint keeps the visible mark about 16px wide inside the existing 28px button, with the complete source and padding intact. The menu bar preserves running, attention and unavailable indicators. Settings navigation has no logo.

## Development builds

- `app-icon-dev.png` is the Figma composition for Debug builds. It adds a visible `DEV` badge while preserving the complete mark and outer transparent margin. `AppIconDev.appiconset` contains its native size exports; Release uses `AppIcon.appiconset`.
- `symbol-dev.png` is a 108 × 52 transparent export, displayed at 54 × 26 inside a 68 × 28 panel button when `import.meta.env.DEV` is true. The button has 6px horizontal padding and an 8px gap to the title. The original mark stays at the same size, followed by an outlined `DEV` label.
- Debug menu images are 44 × 18 at 1x and 88 × 36 at 2x. They pair the 18px state icon with an outlined `DEV` label. The native item uses variable width so neither the mark nor label is squeezed. Production images remain 18 × 18 and 36 × 36.
- In both environments the status-bar mark is scaled to about 17px of visible width. Transparent source padding is allowed outside that small export frame; the complete visible silhouette stays inside it.

Canonical design: [Atd brand and app icon](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/Atd?node-id=1741-95296). The Figma components retain the original raster artwork; they do not claim editable vector paths.

Development design sources: [app icon](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/Atd?node-id=1757-95728), [panel header](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/Atd?node-id=1760-95766), and [menu bar states](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/Atd?node-id=1759-95783).

## Final generation prompt

The source was refined with the built-in image generator using the previous draft as its image reference:

> Refine this exact abstract folded-ribbon logo without cropping any part of it. Preserve the two bold offset curved turns and diagonal connecting band. COMPLETE the upper-right terminal with a smooth fully visible rounded cap, so it no longer looks like a shape cut off by a straight vertical edge. Both endpoints must be intentionally finished and fully visible.
> Scale the ENTIRE complete symbol down so its total bounding box fits comfortably within the middle 60% of a square canvas; at least 20% transparent padding on every side, including around the extreme right and bottom. The whole logo must be visible, centered optically, with balanced ample breathing room. No edge of the artwork may touch the image border.
> Solid flat near-black ink (#111111) on genuine transparent background, crisp clean curves, no white speckles, no shadows, no texture, no gradient, no tile and no text. Output one complete standalone mark. Do not zoom, crop, fill the canvas, or trim off the shape.
