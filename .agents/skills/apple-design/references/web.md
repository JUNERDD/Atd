# Building Apple-style web UIs (HTML / CSS / React / Tailwind)

Current as of **2026-09-30** (the 27 releases; Liquid Glass since 26). Read this when a web page or web app should look, move and feel like current Apple software. This file owns the web kit (`assets/css/`, `assets/js/`, `scripts/build_kit.py`), glass on the web, web performance, frameworks, web-app polish and marketing pages. Design rules stay with their owners and are cited by ID: foundations.md (LAY, COL, CON, TYP, HIT, SYM, WRI, LOC), liquid-glass.md (GL), components.md (CMP, PAT), motion.md (MOT), interaction-feedback.md (FB), system-experiences.md (SYS). Label: (heuristic) is this skill's recommendation where Apple publishes no number.

## Rules at a glance

| ID     | Rule                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| WEB-1  | Build lean: generate CSS (and optional JS) with `scripts/build_kit.py` from only the blocks on screen: about 6 KB gzipped (23 KB minified) for the starter set, ≲ 10 KB gzipped (42 KB minified) for a full app shell. Never Read, paste or inline the whole kit, the demo or the specimen.                          | The script splices only the blocks on screen into the page, so the kit never passes through your context and unused components never ship. |
| WEB-2  | Glass comes only from the kit's one recipe (`.glass` and its member classes, tuned by tokens), and its default look passes CON-1 over the worst backdrop with no fallback active.                                                                                                                                    | Safari and iOS Safari don't support `prefers-reduced-transparency`, so on Apple devices that fallback never fires.                         |
| WEB-3  | Performance: stay within the GL-3 web ceiling (count every `backdrop-filter`, scroll edges included); no glass on repeated items; animate only transform and opacity (MOT-6); no filter, opacity or mask on glass ancestors.                                                                                         | Each surface re-blurs whenever content moves beneath it, and a backdrop root silently flattens glass.                                      |
| WEB-4  | Accessibility parity: native elements first, ARIA only for gaps, a keyboard path for every pointer action, visible focus (FB-6), sheets and alerts through `showModal()`, states visible in forced colors, CON-2 pairs checked.                                                                                      | Styled `div`s lose semantics and focus, and glass hides contrast failures until someone measures.                                          |
| WEB-5  | Marketing and landing pages use page grammar (display type, full-bleed sections, one thin sticky local nav, product imagery, pill CTAs, motion-safe reveals), never app chrome such as tab bars, inset lists or sheets.                                                                                              | An apple.com-style page is a document to scroll, not an app to operate; app chrome there reads as a broken app.                            |
| WEB-6  | Appearance follows the system (COL-4); the HIG says to avoid app-specific appearance settings, so by default offer none. Add an override only when the user or product requires one: it lives in settings as Automatic / Light / Dark, defaults to Automatic and applies before first paint; never a toolbar toggle. | People set appearance once for everything; an override applied late flashes the wrong scheme.                                              |
| WEB-7  | Adapt by container width in three bands, compact < 700 px, regular 700–1099 px, wide ≥ 1100 px (heuristic), with the same functions in each (LAY-1).                                                                                                                                                                 | The web's stand-in for size classes, with no undefined gap between breakpoints.                                                            |
| WEB-8  | Localize the CSS (LOC-1): set `lang` and `dir`, use logical properties and `:dir(rtl)` flips, drop SF tracking for CJK, add CJK font fallbacks.                                                                                                                                                                      | Physical properties break right-to-left layouts, and Latin tracking squeezes CJK text.                                                     |
| WEB-9  | Tokens, not literals: semantic color roles (`--accent-text` for accent-colored text, `--accent` only for fills and tints), text styles, kit state and motion tokens; `-native` values only for pixel-matched mockups.                                                                                                | Tokens carry light, dark, Increase Contrast and scoped tints; literals don't, and raw `--accent` text fails CON-1.                         |
| WEB-10 | Polish like an installed app: safe-area viewport, `theme-color` and `apple-touch-icon`, typed inputs with `autocomplete`, `inputmode` and `enterkeyhint` at ≥ 16 px, `navigator.share` with a fallback.                                                                                                              | These details decide whether a site feels native on iPhone; smaller inputs make iOS Safari zoom on focus.                                  |

## Contents

1. Quick start · 2. Kit map · 3. Tokens you'll touch · 4. Glass on the web · 5. Layout and platform adaptation · 6. Motion and feedback · 7. Accessibility · 8. React, Tailwind and other frameworks · 9. Icons, fonts and licensing · 10. Marketing pages vs app UI · 11. Web-app polish · 12. Don'ts · 13. Sources

---

## 1. Quick start

1. **Pick blocks.** `python3 <skill>/scripts/build_kit.py --list` prints each block's name, requirements, layer, size (raw and minified), native analog and purpose. Take only the blocks for components the screen shows (§2), then `build_kit.py --markup <blocks>` prints each one's markup, states and usage notes: copy class names and structure from there. Add `motion` for busy spinners (`.activity-indicator`) or any `.motion-*` class; `button` doesn't pull it in. Don't Read `assets/css/tokens.css`, the block files, `assets/demo.html` or `assets/specimen.html` end to end (WEB-1); the demo and the specimen are for people to open in a browser.
2. **Build and size.**
   ```sh
   python3 <skill>/scripts/build_kit.py base type button list switch tabbar sheet --css app.css --js app.js --minify
   python3 <skill>/scripts/build_kit.py --size base type button list switch tabbar sheet    # raw / min / gzip
   ```
   The CSS is `tokens.css` plus the blocks in dependency order (requirements are added for you), wrapped in `@layer apple.base, apple.components`. Budget: the starter set `base type glass states button` is about 6 KB gzipped (23 KB minified), a typical iOS app shell (plus toolbar, tab bar, list, switch, segmented control and sheet) ≲ 10 KB gzipped (42 KB minified); `tokens.css` is about 10 KB of the minified total. Over budget means fewer blocks, not hand-trimming; `--all` (≈ 79 KB minified) is for kit development only.
3. **JS is optional.** Pass `--js` only when you call `AppleFeedback` or `AppleMotion` or want a block's enhancer. It writes one classic script: `assets/js/apple-interactions.js` without `export`, plus `assets/js/blocks/<name>.js` for chosen blocks that ship one; `--minify` strips its comments and indentation too. The CSS works without it, drag gestures excepted (add the iOS `:active` line from §6).
4. **Deliver.** In a project, copy the built files in; never link into the skill directory. For a single file, put two empty placeholders in the page and let the script fill them, so the kit never passes through your context:
   ```html
   <!doctype html>
   <html lang="en">
     <head>
       <meta charset="utf-8" />
       <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
       <meta name="color-scheme" content="light dark" />
       <style data-kit></style>
       <style>
         /* page CSS: unlayered, so it beats any kit rule without !important */
       </style>
     </head>
     <body>
       …
       <script data-kit></script>
       <script>
         AppleFeedback.initPressStates();
         Object.values(globalThis.AppleBlocks ?? {}).forEach((b) => b.init());
       </script>
     </body>
   </html>
   ```
   ```sh
   python3 <skill>/scripts/build_kit.py base type button list switch tabbar sheet --minify --inline index.html
   ```
   `--inline` replaces whatever is inside `<style data-kit>` and `<script data-kit>` (for CSS only, leave out both `<script>` tags: the kit tag and the init line). Make it the last step: finish and review the page while the kit tags are still empty, then inline. For a later change, edit the page without reading the kit tags (Read with an offset), then re-run the same command; never edit inside the kit tags.
5. **No Python?** Copy `assets/css/tokens.css` (first, unlayered) and only the block files you need; `head -1 assets/css/blocks/*.css` prints every header (`requires`, `layer`). Paste dependencies first, after `@layer apple.base, apple.components;`, each block inside `@layer apple.base { … }` or `@layer apple.components { … }` as its header says. Keep the layers: kit rules use zero-specificity `:where()`, which any unlayered element reset would override. For JS, copy only the functions you call from `assets/js/apple-interactions.js`.
6. **Customize from outside.** Change tokens and hooks (§3) or add page CSS; don't edit block files for one project. Drop other resets (normalize, Tailwind v3 preflight): `base` is the reset, and an unlayered `button { background: none }` beats `.btn-glass`.

## 2. Kit map

Browser floor: Safari 17.5+, Chrome and Edge 123+, Firefox 128+ (`light-dark()`, `color-mix()`, `:has()`, `@property`); older engines get no fallback, while View Transitions, scroll-driven animations, relative OKLCH colors and `overlay` exit transitions are enhancements with fallbacks. `assets/css/tokens.css` always comes first: unlayered custom properties, `color-scheme`, the `[data-theme]` and `[data-tint]` scopes, media-query overrides. Each block is one file, `assets/css/blocks/<name>.css`, whose first line is its header (`/* @block name | requires: … | layer: … | native: … | purpose */`). A block owns its hover (fine pointers only), pressed, selected, disabled and focus visuals, reduced-motion substitute, forced-colors rules, RTL flips and a HIT-1 hit area. `assets/js/apple-interactions.js` is one ES module exporting `AppleMotion` and `AppleFeedback` (both also on `globalThis`); enhancers in `assets/js/blocks/<name>.js` are classic scripts exposing `AppleBlocks.<name>.init(root)`, safe to call twice.

| Block           | HIG component (rule)                | Classes and hooks                                                                                                                                                                         | SwiftUI / UIKit analog                                          | Notes                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`          | —                                   | element defaults; `.sr-only`, `.surface-system`, `.surface-grouped`, `.hit-44`                                                                                                            | —                                                               | reset, subtree themes; stops decorative animation under reduced motion                                                                                                                                                                                                                 |
| `type`          | Text styles (TYP-1, TYP-2)          | `.t-large-title` … `.t-caption2`, `.t-emph`; `.font-sans`/`-rounded`/`-serif`/`-mono`; `.text-label`/`-secondary`/`-tertiary`/`-accent`                                                   | `Font.TextStyle` / `UIFont.TextStyle`                           | CJK tracking reset                                                                                                                                                                                                                                                                     |
| `type-macos`    | macOS text styles                   | `data-platform="macos"` on `<html>`                                                                                                                                                       | `NSFont.TextStyle`                                              | desktop-first apps                                                                                                                                                                                                                                                                     |
| `shape`         | Concentric shapes (GL-6)            | `.concentric`, `.concentric-inner`, `.capsule`, `.squircle`; hooks `--shape-radius`, `--shape-pad`                                                                                        | `ConcentricRectangle` / `UICornerConfiguration`                 |                                                                                                                                                                                                                                                                                        |
| `glass`         | Liquid Glass (GL-1 … GL-9)          | `.glass`; modifiers `.glass-clear`, `.glass-tinted`, `.glass-dim` on any member (`class="glass glass-clear"`)                                                                             | `glassEffect` / `UIGlassEffect`                                 | the only recipe (§4); `.glass-interactive` lives in `states`                                                                                                                                                                                                                           |
| `states`        | Control states (FB-1 … FB-3)        | `.pressable`, `.hit-extend`, `[data-pressed]`, the `:focus-visible` ring and its halo                                                                                                     | `ButtonStyle` / `UIControl.State`                               | JS: `AppleFeedback`; `.pressable` lays hover and press over your `background-color`                                                                                                                                                                                                    |
| `motion`        | Motion (MOT)                        | `.motion-pop`, `.motion-fade`, `.motion-stagger`, `.motion-scroll-root`, `.motion-scroller`, `.motion-reveal-on-scroll`, `.activity-indicator`                                            | springs and transitions (motion.md)                             | JS: `AppleMotion`                                                                                                                                                                                                                                                                      |
| `field-message` | Inline validation (FB-5)            | `.field-message` + `data-tone`                                                                                                                                                            | —                                                               |                                                                                                                                                                                                                                                                                        |
| `status-pill` ◆ | Off-screen result or Undo (FB-5)    | `.status-pill`                                                                                                                                                                            | —                                                               | optional                                                                                                                                                                                                                                                                               |
| `button` ◆      | Buttons (CMP-2, CMP-3)              | `.btn-glass`, `.btn-prominent`, `.btn-filled`, `.btn-bordered`, `.btn-tinted`, `.btn-plain`; `.btn-destructive`, `.btn-icon`, `.btn-block`, `.btn-large`                                  | button styles / `UIButton.Configuration` (class map: CMP-3)     | glass: `.btn-glass`, `.btn-prominent` only; 44 px tall by default (native regular is 34.3 pt, but glass members can't carry a hit extension), `.btn-large` 50 px; state via `aria-pressed`, `aria-busy`, `:disabled`; on glass, destructive bordered and tinted buttons turn solid red |
| `toolbar` ◆     | Toolbars (CMP-4)                    | `.toolbar`, `.toolbar-group`, `.toolbar-group--divided`, `.toolbar-btn`                                                                                                                   | `ToolbarItemGroup` / `UIToolbar`                                | a selected toggle (`aria-pressed`) is filled with the accent                                                                                                                                                                                                                           |
| `tabbar` ◆      | Tab bars, search tab (CMP-1, CMP-6) | `.tabbar-dock`, `.tabbar`, `.tabbar__item`, `.tabbar__indicator`, `.tabbar-search`, `data-role="search"`                                                                                  | `TabView` / `UITabBarController`                                | CSS only; selection via `aria-current="page"`                                                                                                                                                                                                                                          |
| `list`          | Lists (CMP-7)                       | `.list`, `.list--icons`, `.list--flush`, `.list__row`, `.list-header`, `.list-footer`; `.list__icon`, `.list__label`, `.list__title`, `.list__subtitle`, `.list__value`, `.list__chevron` | `List` / `UICollectionView` list                                | selection via `aria-current` / `aria-selected`; hooks `--list-inset`, `--list-sep-inset`, and `--list-icon-bg` with `--list-icon-fg` (a COL-3 pair) for icon tiles                                                                                                                     |
| `segmented`     | Segmented controls                  | `.segmented`                                                                                                                                                                              | `Picker` (segmented) / `UISegmentedControl`                     | CSS only (native radios)                                                                                                                                                                                                                                                               |
| `switch`        | Toggles                             | `.switch`                                                                                                                                                                                 | `Toggle` / `UISwitch`                                           |                                                                                                                                                                                                                                                                                        |
| `sheet` ◆       | Sheets (CMP-5)                      | `dialog.sheet`, `.sheet__grabber`, `.sheet__header`, `.sheet__title`, `.sheet__body`; `data-detent="medium"`/`"large"`                                                                    | `sheet` + detents / `UISheetPresentationController`             | JS (drag, morph): `AppleBlocks.sheet.open(sheet, source)`, `.close(sheet)`                                                                                                                                                                                                             |
| `scroll-edge`   | Scroll edge effect (GL-7)           | `.scroll-edge-top`, `.scroll-edge-bottom`                                                                                                                                                 | `scrollEdgeEffectStyle` / `UIScrollEdgeEffect`                  | hidden until content scrolls under the bar (no timeline: `.is-scrolled`); counts toward GL-3                                                                                                                                                                                           |
| `field`         | Text and search fields (CMP-6)      | `.field` on the input, `.field__label`; search: `<form class="field--search" role="search">`                                                                                              | `TextField`, `searchable` / `UITextField`, `UISearchController` | clear and Cancel buttons, busy state                                                                                                                                                                                                                                                   |
| `stepper`       | Steppers                            | `.stepper`, `.stepper__btn` + `data-step`, `.stepper__value`                                                                                                                              | `Stepper` / `UIStepper`                                         | JS (hold to repeat)                                                                                                                                                                                                                                                                    |
| `slider`        | Sliders                             | `.slider` + `--value`                                                                                                                                                                     | `Slider` / `UISlider`                                           | JS                                                                                                                                                                                                                                                                                     |
| `progress`      | Progress indicators (FB-7)          | `.progress` + `--value`; spinner `.activity-indicator`                                                                                                                                    | `ProgressView` / `UIProgressView`                               |                                                                                                                                                                                                                                                                                        |
| `alert` ◆       | Alerts (CMP-9)                      | `dialog.alert`, `.alert__title`, `.alert__message`, `.alert__actions`, `.alert__action` (`--primary`, `--destructive`); anchored `.confirm-dialog.glass`                                  | `alert`, `confirmationDialog` / `UIAlertController`             | draws its own actions (kit buttons fail contrast on its glass)                                                                                                                                                                                                                         |
| `menu` ◆        | Menus and popovers (CMP-9)          | `.menu`, `.popover`                                                                                                                                                                       | `Menu`, `popover` / `UIMenu`, `UIPopoverPresentationController` | JS                                                                                                                                                                                                                                                                                     |
| `navbar`        | Navigation bar, large title         | `.navbar`, `.navbar__leading`, `.navbar__title`, `.navbar__trailing`, `.navbar__large-title`; scroller `.motion-scroller`; `data-scroll-threshold`                                        | `NavigationStack` title / `UINavigationBar`                     | large title collapses on scroll (scroll-driven; JS fallback)                                                                                                                                                                                                                           |
| `card`          | Content card, opaque (GL-8)         | `.card`                                                                                                                                                                                   | — (a grouped container)                                         |                                                                                                                                                                                                                                                                                        |
| `empty-state`   | Empty states (PAT-4)                | `.empty-state`                                                                                                                                                                            | `ContentUnavailableView` / `UIContentUnavailableConfiguration`  |                                                                                                                                                                                                                                                                                        |
| `badge`         | Badges                              | `.badge`, `.badge--overlay`, `.badge--dot`                                                                                                                                                | `badge` / `UITabBarItem.badgeValue`                             | darkened red fill, white numerals                                                                                                                                                                                                                                                      |

◆ = glass member (§4), so the block requires `glass`. **JS** = the block may ship an enhancer; its CSS works without it, drag gestures excepted. Other requirements come from the headers, and `--list` is authoritative. Kit maintainers run `build_kit.py --check` after editing a block.

**Naming.** Blocks and files are kebab-case. Classes: component root (`.list`), part `__` (`.list__row`), variant `--` (`.toolbar-group--divided`), families `.btn-*`, `.glass-*`, `.t-*`, `.motion-*`. State lives in ARIA and data attributes (`aria-pressed`, `aria-current`, `aria-busy`, `aria-invalid`, `data-pressed`, `data-tone`, `data-role`), plus `.is-open` and `.is-scrolled` where no attribute fits. Tokens: roles (`--label`), `--system-*`, `--on-*`, `--fs-*`/`--lh-*`/`--tr-*`, `--space-*`, `--corner-*`, `--elev-*`, `--dur-*`/`--curve-*`/`--spring-*`/`--motion-*`, `--press-*`/`--hover-*`/`--focus-*`/`--state-*`, `--glass-*`. Component-scoped properties start with the block name (`--list-*`, `--seg-*`, `--switch-*`, `--sheet-*`, `--tabbar-*`, `--slider-*`); `--_name` is private.

**App-shell markup** (compact width; glass only in the bars and the sheet):

```html
<header class="toolbar">
  <div class="toolbar-group"><button class="toolbar-btn" aria-label="Back">…</button></div>
  <div class="toolbar-group">
    <button class="toolbar-btn" aria-label="Add">…</button
    ><button class="toolbar-btn" aria-label="More">…</button>
  </div>
</header>
<main>
  <h1 class="t-large-title">Settings</h1>
  <div class="segmented" role="radiogroup" aria-label="Show">
    <label><input type="radio" name="show" checked /><span>All</span></label>
    <label><input type="radio" name="show" /><span>Unread</span></label>
  </div>
  <h2 class="list-header">Network</h2>
  <ul class="list">
    <li>
      <label class="list__row"
        ><span class="list__label">Wi-Fi</span
        ><input class="switch" type="checkbox" role="switch" switch checked
      /></label>
    </li>
    <li>
      <a class="list__row" href="#bluetooth"
        ><span class="list__label">Bluetooth</span><span class="list__value">On</span
        ><span class="list__chevron" aria-hidden="true"></span
      ></a>
    </li>
  </ul>
</main>
<nav class="tabbar-dock" aria-label="Main">
  <ul class="tabbar">
    <li class="tabbar__indicator" aria-hidden="true"></li>
    <li>
      <a class="tabbar__item" href="#today" aria-current="page"
        ><svg aria-hidden="true">…</svg>Today</a
      >
    </li>
    <li>
      <a class="tabbar__item" href="#library"><svg aria-hidden="true">…</svg>Library</a>
    </li>
  </ul>
  <button class="btn-glass btn-icon tabbar-search" aria-label="Search">…</button>
</nav>
<!-- or an in-row item with data-role="search" (CMP-6) -->
<dialog class="sheet" aria-labelledby="sheet-title">
  <!-- showModal(); ::backdrop is the scrim -->
  <div class="sheet__grabber" aria-hidden="true"></div>
  <header class="sheet__header">
    <button class="btn-bordered btn-icon" aria-label="Cancel">…</button>
    <h2 id="sheet-title" class="sheet__title">New List</h2>
    <button class="btn-filled btn-icon" aria-label="Done">…</button>
  </header>
  <div class="sheet__body">…</div>
</dialog>
```

Buttons inside the sheet are opaque, because glass never sits on glass (GL-2); Cancel leads and Done trails (CMP-5). A top bar over scrolling content gets `.scroll-edge-top`, not a background or divider (GL-7); it stays hidden until content scrolls under the bar.

## 3. Tokens you'll touch

Names only. Meanings and values live with their owners: the foundations.md token map (COL-1) for color and type roles, motion.md §3 for springs, interaction-feedback.md for states.

| Group                           | Tokens                                                                                                                                                                                                                                                                                                                                                      | Notes                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text, fills, separators (COL-1) | `--label`, `--secondary-label`, `--tertiary-label`, `--quaternary-label`, `--placeholder-text`, `--separator`, `--opaque-separator`, `--fill`, `--fill-secondary`, `--fill-tertiary`, `--fill-quaternary`                                                                                                                                                   | `--secondary-label` passes CON-1 by default; `--secondary-label-native` and `--tertiary-label-native` carry Apple's exact alphas, for pixel-matched mockups and supplementary text only |
| Backgrounds (COL-1)             | `--system-background`, `--secondary-system-background`, `--tertiary-system-background`; `--system-grouped-background`, `--secondary-system-grouped-background`, `--tertiary-system-grouped-background`                                                                                                                                                      | one stack per screen                                                                                                                                                                    |
| Hues, on-colors (COL-3)         | `--system-red` … `--system-brown`, `--system-gray` … `--system-gray6`; `--on-red`, `--on-orange` … `--on-gray`                                                                                                                                                                                                                                              | text or a glyph on a hue fill takes that hue's `--on-*`, never literal white                                                                                                            |
| Accent and links                | `--accent`, `--accent-text`, `--accent-fill`, `--accent-on`, `--focus-ring`, `--link`, `--link-native`                                                                                                                                                                                                                                                      | see below                                                                                                                                                                               |
| Type (TYP-1)                    | `--ff-sans`, `--ff-rounded`, `--ff-serif`, `--ff-mono`; `--fs-*`, `--lh-*`, `--tr-*` for `large-title`, `title1`–`title3`, `headline`, `body`, `callout`, `subheadline`, `footnote`, `caption1`, `caption2`; `--tracking-scale`                                                                                                                             | prefer the `.t-*` classes; sizes are `rem`, so text-size settings and zoom scale them (test 200 %)                                                                                      |
| Layout (LAY-2, HIT-1)           | `--space-0` … `--space-16`, `--margin-page`, `--hit`, `--toolbar-h`, `--tabbar-h`, `--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left`                                                                                                                                                                                                             | `--margin-page` widens from 440 px, like the system margin                                                                                                                              |
| Shape, depth                    | `--corner-xs` … `--corner-2xl`, `--corner-sheet`, `--corner-list`, `--corner-capsule`; `--elev-sm`, `--elev-md`, `--elev-lg`, `--elev-glass`                                                                                                                                                                                                                | nested radii (GL-6): `.concentric`, or `calc()` from the parent's radius and padding                                                                                                    |
| Motion (MOT-2, MOT-11)          | `--dur-fast`, `--dur-base`, `--dur-slow`, `--dur-sheet`, `--dur-press`, `--dur-spring-smooth`, `--dur-spring-snappy`, `--dur-spring-bouncy`; `--curve-standard`, `--curve-out`, `--curve-sheet`; `--spring-smooth`, `--spring-snappy`, `--spring-bouncy`; `--motion-stagger`; hooks `--motion-index`, `--motion-origin`, `--motion-range`, `--motion-delay` | pair each spring with its own `--dur-spring-*`                                                                                                                                          |
| States (FB-3)                   | `--press-scale`, `--press-fill`, `--press-glow`, `--hover-fill`, `--hover-glow`, `--focus-ring-width`, `--focus-ring-offset`, `--focus-halo`, `--state-disabled-opacity`, `--state-selected-fill`, `--state-selected-focus-fill`, `--state-error`, `--state-warning`, `--state-success`                                                                     | tone tokens color icons and borders, not small text; `--focus-halo` is the ring's page-color halo (a `box-shadow`)                                                                      |
| Glass and hooks                 | `--glass-density`, `--glass-saturate`, `--glass-radius` and the other `--glass-*`, `--glow`; hooks `--px`, `--py`, `--value` (slider, progress), `--n`, `--i` (counts, indices)                                                                                                                                                                             | set glass tokens on your element's own selector; `grep -A13 '@hooks' <skill>/assets/css/tokens.css` lists all hooks (don't Read the file)                                               |

- **Accent.** `--accent` is the tint for fills, tints and selection indicators, never text. Accent-colored text (links in copy, plain buttons, selected labels) uses `--accent-text`; filled controls use `--accent-fill` with `--accent-on`; `--focus-ring` is solid `--accent-text`. Re-tint the whole UI with `:root { --accent: var(--system-indigo); }`, or one region with `<section data-tint style="--accent: var(--system-green)">`. The derived tokens re-derive only on `:root` and `[data-tint]`; without the attribute, only direct `--accent` uses follow and text, fills and focus keep the parent's accent. A brand accent still needs its CON-2 check (COL-3).
- **Links.** `--link` is the AA link color apple.com itself uses (#0066CC light, #2997FF dark; ≥ 4.6:1 on every system background, with more contrast again under Increase Contrast). `--link-native` is UIKit's `link` (still the pre-26 #007AFF on iOS 26.3, about 4.0:1 on white): like the other `-native` tokens, keep it for pixel-matched mockups. Accent-colored text that isn't a link (plain buttons, selected labels) uses `--accent-text`.
- **Appearance.** Tokens use `color-scheme` and `light-dark()`, so they follow the OS. `data-theme="light"` or `"dark"` forces a scheme on `<html>` (a settings override, only when WEB-6 allows one) or on any subtree, such as a media player that stays dark.
- **Mac density.** `data-platform="macos"` on `<html>` switches to the macOS text styles, tracking included (macOS uses the same SF table). Nothing goes below `--fs-caption2`: 11 px in the iOS scale, 10 px in the macOS one (TYP-1).

## 4. Glass on the web

**Why the recipe reads as glass.** Browsers can't lens or refract across engines, so `glass.css` stacks cheap cues: a `backdrop-filter` blur for diffusion and legibility, plus saturation so the surface picks up the color beneath; a translucent fill whose strength is one knob, `--glass-density`; a top-lit sheen with a pointer glint (`--glow`, `--px`, `--py`); a specular rim masked to the border box, the strongest single cue; and an inner glow, a thin darker edge and a soft float shadow (the 27 look, GL-12).

**Members and the hook (WEB-2).** The recipe is written once, for `:where(.glass, .btn-glass, .btn-prominent, .toolbar-group, .tabbar, .sheet, .menu, .popover, .alert, .status-pill)`.

- Custom glass opts in with `.glass` (`<aside class="glass sidebar">`). Never write your own `backdrop-filter` or copy the recipe; tune only through tokens on your own selector, such as `.sidebar { --glass-density: 80%; }`.
- Variants are modifiers on a member (`class="glass glass-clear"`, `class="btn-glass glass-clear"`): `.glass-clear` only over rich media, plus `.glass-dim` when the media is bright (GL-4; the web dim is 55 %, not the native 35 %, because 50 % measured 4.4:1 under white text over pure white); `.glass-tinted` for the single primary action (GL-5; `.btn-prominent` is already tinted); `.glass-interactive` adds press and glint, on controls only (FB-12).
- Glass members use both `::before` and `::after`, so `.hit-extend` can't go on them; they already meet HIT-1. Inside a glass container, use borderless items (`.toolbar-btn`, `.tabbar__item`) or opaque buttons, never more glass (GL-2).
- Glass appears by scaling out of its source (`.motion-pop`, `AppleMotion.morph`), not by fading alone (MOT-9).

**Legible with no fallback.** Safari and iOS Safari don't support `prefers-reduced-transparency` (MDN browser-compat-data), so Apple users with Reduce Transparency see your default glass, and no web API exposes the 27 Liquid Glass slider. The default look must pass CON-1 on its own:

- Labels on glass are monochrome `--label` (GL-5); never small accent text on glass. Glass members redefine `--secondary-label` and `--destructive-text` so the kit's hints, field labels, list headers and destructive labels keep 4.5:1 over busy backdrops; your own glass text still uses `--label`. The tab bar's label and selection colors were measured on glass, and text-bearing bars in dark mode already run lower saturation so vivid content doesn't turn muddy; don't recolor them or raise `--glass-saturate`.
- Test at rest and mid-scroll over the most colorful content you ship (GL-11), in light, dark and Increase Contrast. If a label fails, raise `--glass-density` on that element or calm the content beneath; don't add another layer.
- What does fire: `@supports not (backdrop-filter: …)`, `prefers-contrast: more` (Safari supports it), `forced-colors: active`, and `prefers-reduced-transparency` in Chromium. The kit then turns glass into an opaque, bordered surface through tokens; don't write per-component fallbacks.
- Don't imitate the OS slider with an in-page glass control; make the default legible instead.

**Cost and budget (WEB-3).** Every `backdrop-filter` surface re-blurs whenever the content beneath it changes.

- Count surfaces at rest, fully scrolled and with each overlay open, against the GL-3 web ceiling; scroll edges count. In Chrome: `[...document.querySelectorAll('*')].filter(e => e.checkVisibility() && getComputedStyle(e).backdropFilter !== 'none').length`.
- No glass on repeated items such as list rows, cards and grid tiles (GL-1). One toolbar, one tab bar and one sheet is the usual set.
- Never animate `backdrop-filter` or blur radii (MOT-6), and don't raise the kit's blur radii: large blurs over large areas are expensive on phones.

**Backdrop roots.** A `backdrop-filter` samples only up to its nearest Backdrop Root: an ancestor with `filter`, `opacity` below 1, `mask` or `clip-path`, `backdrop-filter`, `mix-blend-mode`, or `will-change` naming one of those; `transform` doesn't create one (CSS Filter Effects 2). Inside a root, glass blurs only that ancestor's content and looks flat. Keep glass a sibling above the scrolling content, not inside a faded or masked wrapper; fade the glass element itself, not its parent; and remember that glass nested in glass can sample only its parent, one more reason for GL-2. Chromium-only SVG refraction (`backdrop-filter: url(#…)`) isn't in the kit; skip it.

## 5. Layout and platform adaptation

**Viewport and safe areas (LAY-1).** With the §1 viewport tag, `viewport-fit=cover` lets content run under the notch and home indicator: pad bars and docks with `--safe-*` (`env(safe-area-inset-*)`), let backgrounds and scrolling content run edge to edge, and keep controls inside. Put clearance for floating bars (padding under the tab bar or toolbar) on an inner wrapper, not on the scroll container, whose padding moves where sticky scroll edges pin. Full-height shells use `100dvh`, never `100vh`. The kit's docks, sheets and overlays are `position: fixed`; in a framed mockup (a phone drawn on a page), put `data-app-frame` on the frame so they position inside it.

**Size-class bands (WEB-7; the edges are heuristic).**

| Band    | Container width | Navigation                                                                                          | Notes                                                                          |
| ------- | --------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Compact | < 700 px        | Floating bottom tab bar (`.tabbar-dock`); large title in content; toolbar groups in the top corners | iPhone layouts                                                                 |
| Regular | 700–1099 px     | Tab bar near the top, or a sidebar people can collapse                                              | iPad-like                                                                      |
| Wide    | ≥ 1100 px       | Sidebar, content, optional inspector                                                                | desktop: consider `data-platform="macos"`, hover (FB-2) and keyboard shortcuts |

```css
.app {
  container: app / inline-size;
}
@container app (width >= 700px) {
  /* regular */
}
@container app (width >= 1100px) {
  /* wide */
}
```

Custom properties can't appear in query conditions, so the band edges are literals. Keep the same destinations and actions in every band (LAY-1); only the presentation changes. A sidebar is a `<nav>` column; if it floats as glass, give its `.glass` a higher `--glass-density` (large glass reads more opaque) and count it (GL-3). Never put the phone's bottom tab bar on a wide desktop layout.

**Right to left (LOC-1).** Set `dir="rtl"` on `<html>` (`dir="auto"` on user text). Kit blocks mirror their chevrons, thumbs, knobs and indicators with `:dir(rtl)`. Your CSS uses logical properties (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`) and flips custom directional icons with `.icon-forward:dir(rtl) { scale: -1 1; }`. Don't flip logos.

**Chinese, Japanese, Korean (LOC-1).** Set `lang` (`zh-Hans`, `zh-Hant`, `ja`, `ko`) on `<html>` or the element. SF tracking is multiplied by `--tracking-scale`, which the kit sets to 0 for these languages; in hand-rolled CSS write `:is(:lang(zh), :lang(ja), :lang(ko)) { --tracking-scale: 0; }`, because Chrome rejects the list form `:lang(zh, ja, ko)` and drops the whole rule. Append the CJK families LOC-1 lists after the system stack (override `--ff-sans` under the same selector), and loosen `--lh-*` for CJK body text as LOC-1 describes. Keep form fields at 16 px or more (§11).

## 6. Motion and feedback

The recipes live with their owners; follow them there rather than restating them.

- **motion.md §14:** springs from tokens, morphing from the source with View Transitions (`AppleMotion.morph`), popover and dialog enter and exit (`.motion-pop`, `.motion-fade`), the large-title collapse on scroll (`.motion-scroll-root`, `.motion-scroller`, `.motion-reveal-on-scroll`), drag with velocity handoff (`AppleMotion.animateSpring`), and reduced motion (MOT-5).
- **Scroll-linked pieces need `.motion-scroller`.** The scroll-linked reveal (`.motion-reveal-on-scroll`) and the `navbar` collapse run only when the element that actually scrolls has `.motion-scroller` (`<html class="motion-scroller">` when the page scrolls), plus `.motion-scroll-root` on a common ancestor when the revealed element sits outside the scroller.
- **interaction-feedback.md §11:** the `:active` → `[data-pressed]` selector contract; busy, toggle and validation markup; press tracking with slop and cancel; keyboard parity; web haptics (the `switch` attribute only); hit-area measurement (FB-11); the glass glint.
- **Press timing (MOT-11).** Press-in runs on `--dur-press` with `--curve-out`; the release springs back on `--dur-spring-snappy` with `--spring-snappy`; the depth is `--press-scale`, which drops to 1 under reduced motion. Kit controls already do this, and custom controls get it from `.pressable`.
- **JS.** Call `AppleFeedback.initPressStates()` once (it also makes iOS Safari apply `:active`) and `AppleFeedback.initGlassGlint()` if you use glass; `AppleFeedback.announce()` speaks outcomes (FB-5). Without the script, add `document.addEventListener('touchstart', () => {}, { passive: true })`, or iOS Safari shows no `:active` states. Check `AppleMotion.reducedMotion()` before starting motion in your own code.
- **Reduced-motion stop.** Under `prefers-reduced-motion: reduce`, `base` stops keyframe animations with `!important` in the `apple.base` layer, which page CSS can't override (a layered `!important` outranks unlayered ones). Transitions are untouched, so fades keep working (MOT-5). An indicator that must keep moving needs `role="progressbar"`, a `<progress>` element, or an `aria-busy="true"` ancestor, as the kit's `.activity-indicator` markup has (a "Checking…" `.field-message` takes `aria-busy="true"` itself).

## 7. Accessibility

**WEB-4** in practice:

- **Semantics first.** Use `<button>`, `<a href>`, `<input>`, `<dialog>`, `<nav>`, lists and headings; ARIA fills only real gaps. Icon-only buttons get `aria-label`, decorative SVGs `aria-hidden="true"`, visually hidden text `.sr-only`. The §2 markup shows the core patterns: the tab bar is a `<nav>` of links with `aria-current="page"` (navigation, not an ARIA `tablist`, which is for in-page tabs); the segmented control is native radios in a labeled `role="radiogroup"`, so arrow keys work; a switch is `<input type="checkbox" role="switch" switch>` inside `<label class="list__row">`. Toggle buttons use `aria-pressed` and also swap to a filled symbol (COL-2).
- **Dialogs.** Sheets and alerts are `<dialog>` elements opened with `showModal()`: the page behind turns inert, Esc closes, focus returns to the opener, and `::backdrop` is the scrim. Label them with `aria-labelledby`; an alert also takes `role="alertdialog"` and `aria-describedby`. Put `autofocus` on the first field or control, never the grabber. Framed mockups open with `show()` and set `inert` on everything else on the page; `sheet.js` does both and still morphs from the source.
- **Other components.** Menus and popovers use `[popover]` with `popovertarget`; add `role="menu"` only if you also implement arrow keys, Home, End and Esc. Fields keep a visible `<label>`; errors set `aria-invalid` and point `aria-describedby` at a `.field-message`. Sliders and progress bars are native `<input type="range">` and `<progress>`, with `aria-valuetext` when units matter. The large title is the page's `<h1>`; the collapsed inline title repeats it, so mark that copy `aria-hidden="true"`. Busy controls follow FB-7 (`aria-busy`, `aria-disabled`, `.activity-indicator`).
- **Keyboard parity.** Every pointer action has a keyboard path: drag-to-dismiss sheets also have Cancel and Done, reordering has buttons or a menu, and no action exists only on hover (FB-2).
- **Focus (FB-6).** The kit's `:focus-visible` ring is solid `--focus-ring` with a thin page-color halo (`--focus-halo`), so it keeps 3:1 over glass and photos too; list rows get an inset highlight that `.list`'s clipping can't cut. Never remove an outline without a replacement, and don't clip a focusable child with `overflow: hidden` unless its ring is inset.
- **Forced colors.** Kit blocks map their states to system colors. Your own controls must not carry state only in backgrounds or shadows; use `forced-color-adjust: none` only where a state would otherwise vanish.
- **Contrast and settings.** Check the CON-2 pairs in light, dark and `prefers-contrast: more`, including text on glass over its worst backdrop (WEB-2). Measure web text with `scripts/contrast.py FG BG --size PX [--bold] --wcag`; for text on glass, sample the rendered colors under the label in a screenshot at its worst backdrop. `--state-*` tones color icons and borders, not text. Honor `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion`, `forced-colors` and, in Chromium, `prefers-reduced-transparency`; test 200 % text (TYP-1). Hit areas meet HIT-1: add `.hit-extend` to small visuals and measure (FB-11).

## 8. React, Tailwind and other frameworks

Keep the built kit as the single source: kit classes work as-is in JSX, and Tailwind handles layout and one-offs.

**Tailwind v4.** Import the built kit into Tailwind's `components` layer so utilities can override it; the kit's `apple.base` and `apple.components` layers nest inside it, above Tailwind's preflight. `@theme inline` is required because the theme variables point at kit variables.

```css
@import 'tailwindcss';
@import './apple-kit.css' layer(components); /* the output of build_kit.py */

@theme inline {
  --color-label: var(--label);
  --color-label-2: var(--secondary-label);
  --color-label-3: var(--tertiary-label);
  --color-bg: var(--system-background);
  --color-grouped: var(--system-grouped-background);
  --color-cell: var(--secondary-system-grouped-background);
  --color-separator: var(--separator);
  --color-fill: var(--fill);
  --color-accent: var(
    --accent-text
  ); /* text-accent, border-accent: accent-colored text that passes CON-1 */
  --color-accent-fill: var(--accent-fill);
  --color-on-accent: var(--accent-on); /* bg-accent-fill + text-on-accent */
  --color-tint: var(--accent); /* bg-tint/15, fill-tint: fills and glyphs only, never text-tint */
  --color-link: var(--link); /* text-link: AA link text */
  --color-sys-blue: var(--system-blue);
  --color-sys-green: var(--system-green);
  --color-sys-red: var(--system-red);
  --font-sans: var(--ff-sans);
  --font-rounded: var(--ff-rounded);
  --font-serif: var(--ff-serif);
  --font-mono: var(--ff-mono);
  --radius-list: var(--corner-list);
  --radius-sheet: var(--corner-sheet);
  --shadow-glass: var(--elev-glass);
  --ease-sheet: var(--curve-sheet);
  --text-large-title: var(--fs-large-title);
  --text-large-title--line-height: var(--lh-large-title);
  --text-large-title--letter-spacing: calc(var(--tr-large-title) * var(--tracking-scale));
  --text-body: var(--fs-body);
  --text-body--line-height: var(--lh-body);
  --text-body--letter-spacing: calc(var(--tr-body) * var(--tracking-scale));
  /* the same three lines for title1–3, headline, callout, subheadline, footnote, caption1, caption2 */
}
```

- The kit's raw names (`--corner-*`, `--elev-*`, `--curve-*`, `--ff-*`) stay clear of Tailwind's `--radius-*`, `--shadow-*`, `--ease-*` and `--font-*` namespaces, so no mapping is circular. `--text-*--letter-spacing` is a documented Tailwind v4 suffix; multiplying by `--tracking-scale` keeps the CJK reset working.
- Kit colors follow `color-scheme`, so they need no `dark:` variants. Tailwind's default `dark:` follows only the OS and ignores a `data-theme` override, so write your own colors as `light-dark()` values rather than `dark:` pairs.
- Tailwind v3 emits unlayered utilities, which already beat the layered kit; turn off its preflight (`corePlugins: { preflight: false }`), map colors in `theme.extend.colors` (`label: "var(--label)"`), and use `color-mix()` arbitrary values for opacity, since `<alpha-value>` doesn't work with `light-dark()` colors.

**React.**

```tsx
export const Button = ({
  variant = 'bordered',
  className = '',
  ...p
}: React.ComponentProps<'button'> & {
  variant?: 'filled' | 'bordered' | 'tinted' | 'plain' | 'glass' | 'prominent';
}) => <button type="button" {...p} className={`btn-${variant} ${className}`} />; // glass variants only in bars or over media (CMP-3)
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={id} onClose={onClose}>
      …
      <h2 id={id} className="sheet__title">
        {title}
      </h2>
      …{children}
    </dialog>
  );
}
```

- Call `AppleFeedback.initPressStates()` once from the entry file, not from a component effect (StrictMode runs effects twice in development). Block enhancers take a root: `AppleBlocks.sheet.init(el)` after mount.
- A `Glass` primitive belongs only to the functional layer; don't wrap every card in a "GlassCard" (GL-1).
- If the product needs an appearance override (WEB-6), apply the persisted choice before first paint with an inline `<head>` script: `try { const t = localStorage.getItem("appearance"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}`. In Next.js, put it in the root layout and add `suppressHydrationWarning` to `<html>`.
- Vue, Svelte and the rest use the same classes and tokens. Flutter (Cupertino) and React Native aren't the web kit: use their iOS components and apply the design rules by ID.

## 9. Icons, fonts and licensing

- **Fonts.** Use the kit's system stacks (`--ff-sans`, `--ff-rounded`, `--ff-serif`, `--ff-mono`, built on `-apple-system`/`system-ui`, `ui-rounded`, `ui-serif`, `ui-monospace`), which resolve to SF Pro, SF Pro Rounded, New York and SF Mono on Apple devices. Never self-host, embed or redistribute those fonts: Apple licenses them for Apple-platform software and its mockups, not for websites. Skip web fonts when the goal is "feels native".
- **Icons (SYM-1).** SF Symbols are licensed for Apple-platform apps and mockups only: no SF Symbols glyphs, exported SVGs or font in a website or cross-platform web app. Use one open set, such as Lucide (ISC), Phosphor (MIT), Tabler (MIT), Heroicons (MIT) or Radix Icons (MIT). Match SF weights with about 1.75–2 px strokes at 22–24 px for toolbar and list glyphs, use filled variants for selected tab items, and center glyphs optically in `--hit` targets. Inline SVG with `currentColor` follows `--label`, `--accent-text`, Increase Contrast and forced colors.
- **Settings-style tiles.** A `.list__icon` tile uses a `--system-*` fill with its matching `--on-*` glyph color (COL-3), never hard-coded white.
- **Trademarks.** No Apple logos, wordmark, SF Symbols artwork or Apple product names as branding; no device frames that imitate a specific product (Dynamic Island cutouts included); no claim of affiliation. Generic frames and "iOS-style" wording are fine. The only exception is the official Sign in with Apple button, used as Apple specifies (PAT-3).
- **System surfaces.** Widgets, Live Activities and the Dynamic Island are native (system-experiences.md). An HTML mockup of one draws the system frame and keeps everything inside it opaque, with no glass of its own (SYS-1).

## 10. Marketing pages vs app UI

An apple.com-style landing, product or feature page is a document people scroll, not an app they operate (WEB-5). It shares the foundations (system type, semantic colors, CON-1, LOC-1), not the app chrome. The numbers below are conventions, not Apple specs.

| Element   | Do                                                                                                                                                                                                                                                                                                                            | Kit                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Type      | A display scale above the app styles: `clamp()` headlines of roughly 48–96 px, bold or semibold, leading about 1.05–1.1, letter-spacing near 0; one headline and a short subhead per section; body copy stays in the text styles                                                                                              | `--ff-sans`, `.t-*` for copy                           |
| Rhythm    | Full-bleed sections with one message each: product name, headline, subhead, one or two CTAs, then imagery. Generous vertical space (`clamp()`, roughly 80–160 px). Alternate plain and grouped-gray sections, with the occasional dark one (`data-theme="dark"`). Center heroes; left-align detail copy at a readable measure | `--system-background`, `--secondary-system-background` |
| Local nav | One thin sticky glass bar: product name leading, a few section links, one pill CTA trailing. It's usually the page's only glass (GL-3)                                                                                                                                                                                        | `.glass` on the `<nav>`, `.btn-filled`                 |
| Imagery   | Large product imagery and video on matching backgrounds; brand color lives in the content (GL-10). `srcset`/`sizes`, explicit `width` and `height`, AVIF or WebP, `loading="lazy"` below the fold, `fetchpriority="high"` for the hero; video `muted playsinline` with a visible pause control                                | —                                                      |
| CTAs      | Pill buttons: one filled primary (Buy, Get started) and one plain, link-style secondary ("Learn more ›") per region (CMP-2)                                                                                                                                                                                                   | `.btn-filled`, `.btn-plain`, `.btn-large`              |
| Motion    | Scroll-linked reveals that fade content up once as it enters; nothing waits on motion or JS, and reduced motion shows everything in place (MOT-5)                                                                                                                                                                             | snippet below                                          |
| Never     | Tab bars, inset grouped lists, sheets, segmented controls or toolbars as page structure; glass cards or tiles; auto-advancing carousels without a pause control                                                                                                                                                               | —                                                      |

```css
@media (prefers-reduced-motion: no-preference) {
  @supports (animation-timeline: view()) {
    .reveal {
      animation: reveal linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 60%;
    }
  }
}
@keyframes reveal {
  from {
    opacity: 0;
    translate: 0 24px;
  }
}
```

Engines without scroll-driven animations (Firefox today) simply show the content. Forms on these pages (newsletter, search) use `.field` with `.btn-filled`; the footer is small `--secondary-label` text in link columns.

## 11. Web-app polish

**Head.** In addition to the §1 tags:

```html
<meta name="theme-color" media="(prefers-color-scheme: light)" content="…" />
<!-- the resolved page background, per scheme -->
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="…" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<!-- 180×180 PNG, square and full-bleed: iOS applies the mask -->
<link rel="manifest" href="/manifest.webmanifest" />
<!-- name, icons, "display": "standalone" -->
```

Meta tags can't read CSS variables, so write resolved values and update them from JS when a WEB-6 override changes the scheme. A standalone web app has no browser back button, so keep back navigation in the page (`@media (display-mode: standalone)`).

**Inputs.** Give every field its real `type` and hints, so the right keyboard and AutoFill appear (PAT-3):

```html
<input type="email" autocomplete="email" enterkeyhint="next" />
<input type="search" enterkeyhint="search" />
<input autocomplete="one-time-code" inputmode="numeric" />
<!-- SMS codes -->
<input autocomplete="username webauthn" />
<!-- passkey AutoFill -->
<input type="password" autocomplete="new-password" />
<!-- strong-password suggestion -->
```

Keep field text at 16 px or more on touch layouts (the `field` block uses `--fs-body`), because iOS Safari zooms into smaller fields on focus. Never disable zoom with `maximum-scale` or `user-scalable=no`. Turn off `autocapitalize` and `spellcheck` for usernames and codes.

**Share (PAT-3).** `navigator.share()` opens the system share sheet in Safari. Call it from the click handler (it needs HTTPS and a user gesture) and fall back to copying the link, confirmed in place (FB-5):

```js
shareButton.addEventListener('click', async () => {
  const data = { title: document.title, url: location.href };
  if (navigator.canShare?.(data))
    await navigator.share(data).catch(() => {}); // AbortError: the person cancelled
  else {
    await navigator.clipboard.writeText(data.url);
    AppleFeedback.announce('Link copied');
  }
});
```

**Charts and images.** Chart series use `--system-*` hues and come with a text summary or data table, since color is never the only carrier (COL-2). Images ship `srcset` at 2× and 3×, explicit `width` and `height`, and a placeholder while loading.

## 12. Don'ts

- Don't Read, paste or inline the whole kit, the demo or the specimen, or ship an `--all` build (WEB-1).
- Don't hand-write `backdrop-filter` glass or use SVG refraction (WEB-2); no glass on content (GL-1), glass on glass (GL-2) or several tinted neighbors (GL-5).
- Don't exceed the GL-3 web ceiling, animate blur or `backdrop-filter` (MOT-6), or put filters, opacity or masks on glass ancestors (WEB-3).
- Don't count on `prefers-reduced-transparency`, and don't imitate the OS Liquid Glass slider in the page (WEB-2).
- Don't use raw `--accent` for text, `-native` tokens for essential text, or hard-coded hex values (WEB-9).
- Don't add an appearance override the user or product doesn't require, or put a theme toggle in the toolbar (WEB-6); don't put the phone's bottom tab bar on a wide layout (WEB-7), or app chrome on a marketing page (WEB-5).
- Don't lay out with physical `left`/`right`, or reset CJK tracking with `:lang(zh, ja, ko)` (WEB-8).
- Don't remove focus outlines without a replacement, disable zoom, or hide content until a script or animation runs (WEB-4).
- Don't use Apple logos, SF Symbols artwork, self-hosted SF fonts or product-imitating device frames (§9).

## 13. Sources

- Apple HIG: Color, Typography, Materials, Layout, Right to left, Accessibility, Buttons, Toolbars, Tab bars, Sheets, SF Symbols (https://developer.apple.com/design/human-interface-guidelines/); fonts and their license (https://developer.apple.com/fonts/).
- Apple _Safari Web Content Guide_ (archived): touch icons, and `:active` needing a touch listener (https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/). WebKit, _WebKit Features in Safari 18.0_: the `switch` input and its haptics (https://webkit.org/blog/15865/webkit-features-in-safari-18-0/).
- MDN browser-compat-data (checked 2026-09-30): no `prefers-reduced-transparency` in Safari; no `:lang()` argument lists in Chrome; the browser floor. https://github.com/mdn/browser-compat-data
- CSS Filter Effects 2, Backdrop Root: https://drafts.csswg.org/filter-effects-2/#BackdropRoot · HTML Standard, `dialog` and `popover`: https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
- MDN: container queries, scroll-driven animations, View Transitions, Web Share API, `autocomplete` and WebAuthn conditional mediation. https://developer.mozilla.org/
- Tailwind CSS v4: `@theme inline` and theme namespaces (https://tailwindcss.com/docs/theme), `--text-*--letter-spacing` (https://tailwindcss.com/docs/font-size), dark mode (https://tailwindcss.com/docs/dark-mode), layers (https://tailwindcss.com/docs/adding-custom-styles).
- Liquid Glass technique ideas (the kit's code is original): kube.io, "Liquid Glass in the Browser: Refraction with CSS and SVG" (https://kube.io/blog/liquid-glass-css-svg/); w3c/svgwg#1142, backdrop refraction proposal (https://github.com/w3c/svgwg/issues/1142).
