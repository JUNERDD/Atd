# Interface scenes

The “Interfaces” section (`#cases`) is an eight-scene scroll sequence. Its labels, captions and image
paths live in [`src/content/cases.ts`](../../src/content/cases.ts). These are design previews exported
from the canonical Figma file, not recordings of a live browser agent.

## Active assets

All eight PNGs are **1440 × 900**, use the same canonical Desktop instance and preserve the entire
scene. Frames are in “W · Website · Interface scenes · shared desktop” (`2462:142863`).

| File                       | Export frame  | Application design source                                    |
| -------------------------- | ------------- | ------------------------------------------------------------ |
| `ui/selection-toolbar.png` | `2462:142864` | Selection and toolbar `1798:97448`                           |
| `ui/mini-panel.png`        | `2462:142972` | Expanded Mini Panel `2294:134033` and pointer `2294:134080`  |
| `ui/screenshot.png`        | `2462:143105` | Annotated capture `1699:74894`                               |
| `ui/main-panel.png`        | `2462:143430` | New-task panel `1:400`                                       |
| `ui/chat.png`              | `2462:143565` | Conversation `1637:159329`                                   |
| `ui/settings.png`          | `2462:143808` | Settings window `1123:41395`                                 |
| `ui/apps.png`              | `2462:144114` | My apps `1866:88787` and Notes `2237:132814`                 |
| `ui/automations.png`       | `2476:144190` | Automations overview with memory consolidation `2419:156499` |

The common desktop comes from `2294:133952`, with its wallpaper, menu bar and Dock. The exported
scenes reuse connected application components. The screenshot scene preserves the capture selection,
annotations, controls and dimming while its duplicate desktop layers are hidden to reveal the shared
background. The provider identity source keeps its Default badge beside the name. My apps search
examples use one icon inside the input; their source frames and website scene stay aligned.
User-message bubbles, the Default badge and Notes rows use the existing `glass/control-wash`
variable so their fills retain the window's backdrop. The Notes settings icon binds to the local
dark-theme `foreground` variable rather than the imported library's appearance.
The automation scene keeps the overview's connected components and routine task examples; failure
examples remain in the original review frame. Its selected navigation and unread badge reuse the
glass fills already shown in the other website scenes.
The shared glass switch pill binds its fill and edge to translucent color variables, preserving
72% fill and 10% edge opacity in nested instances, including “Pause all automations”.

## Scene layers

The showcase does not show the flat PNGs: it stacks each scene's layers over one shared desktop
(`layers/desktop.webp`) and animates them. The layers come from
“W · Website · Interface scene layers (matte exports)” (`2552:144525`), on the same page as the
scenes. [`scripts/case-layers.json`](../../scripts/case-layers.json) lists, per scene, its layers
bottom to top, their source nodes and their sheets. Each sheet row is a clone of the scene twice:
composited through that layer (later layers at zero opacity, so auto layout never reflows), and
the layer alone on a transparent canvas (ancestors keep their geometry and clipping but not their
paint; strokes keep their weight). The sheets export as PNG at 2x.

Most surfaces are glass and blur the wallpaper behind them, which an export on a transparent
canvas loses. [`scripts/matte-layers.py`](../../scripts/matte-layers.py) recovers each layer from
the composite below it and the composite through it, as the most transparent straight-alpha image
that reproduces the scene and is never more transparent than the layer's own coverage. Layers
without glass are their exact alone export. It writes `layers/<scene>/<n>-<layer>.webp` cropped to
each layer's box, `src/content/case-layers.ts` and `src/sections/cases/case-layers.css`, then
recomposites the decoded files and prints each scene's error against Figma (a mean below 1/255;
the remaining maximum is lossy WebP on the Dock icons).

## Updating the showcase

1. Update the corresponding Figma scene, retaining the common canvas and desktop component. Keep
   small floating tools at their intended screen position and preserve full window bounds.
2. Export the complete frame as a PNG at the default scale and save it to the matching `ui/` path.
   Keep exact exports in this directory rather than relying on expiring Figma URLs or CSS crops.
3. Rebuild the scene's sheet in the layer section from the updated scene, keeping one row per layer
   as above, and update `scripts/case-layers.json` when layers or sheets change. Export every sheet
   listed there at 2x into one directory, each file named after its node (`2553-145107.png`), then
   run `python3 apps/website/scripts/matte-layers.py <directory>` from the repository root (numpy
   and Pillow with WebP). A new or renamed layer also needs its entrance in
   `src/sections/cases/scenes.css`.
4. Keep both languages of the label, caption and alt text aligned with the displayed functionality.
5. Verify all eight scenes and their entrances while scrolling through the pinned stage, both
   directions, the bars' fill and their jumps, keyboard access, reduced motion and the phone,
   landscape-phone and desktop layouts in both languages. Run the website lint, type check and
   production build.

The scroll position, not a timer, decides the scene: see “Interface showcase” in the
[website README](../../README.md). A scene whose layers fail to load shows a localized message
with a link to its flat export.

## Archived recordings and Summon assets

The previous case films, posters and Summon captures are retained as archived assets. The homepage
no longer loads them. Their provenance and capture guidance are preserved here.

### Archived set

| File stem               | Length     | What the real app shows                                                                     |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `files-and-permissions` | 15 seconds | Reads three project files, requests write approval, and creates `release-readiness.md`.     |
| `reusable-commands`     | 15 seconds | A saved command accepts audience and format parameters and produces a customer email.       |
| `memory-in-action`      | 16 seconds | Saves a writing preference, inspects the memory, and reads it in a new task.                |
| `automation-to-result`  | 15 seconds | Sets a weekday check, carries over the previous result, and reports changed project status. |

These are **continuous recordings of the real native application**, edited into short workflows,
using **Muse Spark 1.3 Contributor** (`muse-spark-1.3-contributor`) with **xhigh** reasoning. Menus,
parameter changes, scrolling, tool execution and AI responses come from recorded application frames.
Idle time is cut or accelerated, so the films are not a model-speed benchmark. They are not assembled
from screenshots. All input is from the fictional Aster project. The automation was tested with
**Run now**; the film does not claim the scheduled timer fired. Its history includes an unchanged
check that stayed quiet and a subsequent check that detected an updated release status.

### Capture and composition

- Use an isolated app data directory and synthetic, publishable inputs. Keep credentials, personal
  history, notifications and private paths out of the frame.
- Default panel: 560 × 720 pt. Feature captures: 1040 × 760 pt. Settings: 1000 × 720 pt.
- Capture the entire native window, including its header and composer, without its external shadow.
  Keep recording indicators intact. Record the app together with its background so the native glass
  includes the real desktop composition; never flatten the window against black or reconstruct UI.
- Keep each story to 15–16 seconds: context, key operation, then the useful result. Hold the result
  for 4–5 seconds. Shorten idle waiting and typing.
- Use the approved background behind the actual app during capture. Add a gentle 2.5% camera
  move and direct cuts between recorded operations. Every
  frame keeps the whole window visible; no heavy extra shadow.
- Source captures are 1×. A 1920 × 1200 export does not create Retina detail. Verify the actual page
  size and full-screen view; use 2× sources for future recaptures when available.

The captures, generation evidence and deterministic `live/render-live.mjs` compositor are in the gitignored
`tmp/uiux-features-20261007/`. Only the final MP4s and posters belong in this public directory.

The former Summon section used matching native 560 × 720 captures in English and Chinese, including
a real unsent draft, from `public/summon/`. The full header and footer remain visible in these archived
assets. Its show/hide demonstration did not run an agent in the browser.

### Background credit and license

All four archived films and the former Summon stage use **“a black and white photo of wavy lines” by Pawel Czerwinski**:

- [Original photograph on Unsplash](https://unsplash.com/photos/a-black-and-white-photo-of-wavy-lines-oIT3X1oPtFA)
- [Unsplash License](https://unsplash.com/license), checked 2026-10-07. Free commercial use and
  modification are permitted; this is not CC0. Attribution is appreciated but not required.

The photo was cropped to frame the native window. The composed films and resized Summon background
remain in the archive; the homepage does not load them.

### Recording export

| Property    | Value                                               |
| ----------- | --------------------------------------------------- |
| Canvas      | 1920 × 1200 (16:10)                                 |
| Video       | H.264 High, yuv420p, 30 fps, no audio               |
| Encoding    | `libx264 -preset fast -crf 19 -movflags +faststart` |
| Size target | Under 15 MB per video; under 200 KB per poster      |

Export the poster from the final movie so it matches the first frame:

```sh
ffmpeg -i public/cases/<id>.mp4 -frames:v 1 -q:v 3 public/cases/<id>.jpg
ffprobe -v error -show_entries format=duration -of csv=p=0 public/cases/<id>.mp4
```

These recordings are retained as source material and are not referenced by the current showcase.
Before using a recording again, verify playback, its poster, mobile layout and reduced motion.
Never publish raw recordings, provider configuration, credentials or the isolated app data directory.
