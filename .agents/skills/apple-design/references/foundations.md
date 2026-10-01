# HIG foundations (current)

Current as of **2026-09-30**, for the **27** releases (iOS, iPadOS, macOS, watchOS, tvOS, and visionOS 27, shipped September 2026). Liquid Glass (introduced in 26) is the baseline. This file owns layout, color and on-color, contrast, typography, hit targets, symbols and images, writing, and localization. Other owners are cited by rule ID: glass and materials in liquid-glass.md (GL), components in components.md (CMP), motion in motion.md (MOT), control feedback and haptics in interaction-feedback.md (FB), and API spellings in swiftui.md. Hex values live in the web kit's token file; don't read it for design decisions (web.md explains the build). Claims not confirmed in an Apple primary source are marked "(unverified)".

## Rules at a glance

| ID    | Rule                                                                                                                                                                                                                                                                                                                | Why                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| LAY-1 | Lay out by size class, window width, and safe areas, never by device or orientation. Backgrounds and content run edge to edge under bars; controls and critical text stay inside the safe area.                                                                                                                     | Windows resize freely (iPad, resizable iPhone apps in 27, iPhone Duo), so device checks break.                          |
| LAY-2 | Use the system margins: 16 pt in windows up to ~402 pt wide, 20 pt from 440 pt. A 4/8-pt spacing rhythm is a convention, not an HIG rule.                                                                                                                                                                           | Matching the framework's margins keeps custom content aligned with system bars, lists, and titles.                      |
| COL-1 | Use semantic system colors by role (label, secondaryLabel, backgrounds, separator, fills), each with light, dark, and increased-contrast variants. Custom colors need all three.                                                                                                                                    | Apple retunes values between releases; roles adapt to appearance, accessibility settings, and the glass above.          |
| COL-2 | One accent (tint) marks interactive elements, and color is never the only carrier of meaning.                                                                                                                                                                                                                       | A color that means two things means nothing; color-only cues vanish for color-blind people, in grayscale, and in glare. |
| COL-3 | Choose each fill's label or glyph color by measured contrast (text ≥ 4.5:1, glyphs ≥ 3:1). Yellow, orange, green, mint, teal, and cyan fills take a dark label (or, in light mode, their increased-contrast hue). Derive the on-color for any custom accent; never promise it.                                      | White on those six fills measures 1.4–2.3:1, below even the glyph minimum.                                              |
| COL-4 | Follow the system appearance: no app-only light/dark setting (the HIG says to avoid one); immersive media apps may stay dark. A web app adds an override only when the user or product requires one, as WEB-6 describes. Dark palettes are not inversions.                                                          | People choose appearance once for the whole system; a per-app switch contradicts it and doubles testing.                |
| CON-1 | Text ≥ 4.5:1 up to 17 pt, ≥ 3:1 at 18 pt or bold; glyphs and control boundaries ≥ 3:1. Secondary and tertiary labels are for supplementary text only (or use their increased-contrast values). On the web, WCAG's large-text rule applies instead (≥ 24 px, or ≥ 18.66 px bold); measure with `contrast.py --wcag`. | HIG and WCAG AA. In light mode secondaryLabel measures only ~3.3–3.4:1 and tertiaryLabel ~1.7:1.                        |
| CON-2 | Check the risky pairs in light, dark, and Increase Contrast: text on glass over its worst backdrop, label on accent fill, glyph on tinted tile, link and secondary text on grouped backgrounds.                                                                                                                     | These pairs are where Apple-style UIs actually fail; semantic colors cover the rest.                                    |
| TYP-1 | Use the system font and Dynamic Type text styles (iOS Body 17 pt, macOS Body 13 pt). Support ≥ 200 % enlargement (140 % on watchOS), and let layouts reflow.                                                                                                                                                        | Text styles scale, honor Bold Text, and keep the hierarchy; fixed sizes break at accessibility sizes.                   |
| TYP-2 | Build hierarchy with weight and size: bold, left-aligned titles; no ALL-CAPS headers. iOS 26 grouped-list section headers are 17 pt semibold (emphasized Body), in title-style capitalization.                                                                                                                      | The 26 design favors bolder, left-aligned type, and the system stopped uppercasing section headers.                     |
| HIT-1 | Every touch control's hit region is ≥ 44×44 pt (visionOS 60, tvOS 66, watchOS 44; macOS 28, 20 at the smallest). A visible control may be smaller (≥ 28 pt) only if its hit region is extended. Measure the tappable box, extensions included.                                                                      | Small targets are the most common interaction failure, and the visual hides it.                                         |
| HIT-2 | Leave ~12 pt around bezeled controls and ~24 pt around borderless ones.                                                                                                                                                                                                                                             | Spacing prevents mis-taps as much as size does.                                                                         |
| SYM-1 | Use SF Symbols in native UI, matched to the weight and scale of adjacent text. On the web, use a matching line-icon set (SF Symbols license).                                                                                                                                                                       | Symbols align with SF text, scale with Dynamic Type, and adapt to rendering modes and settings.                         |
| WRI-1 | Pick a voice and one capitalization style per element type, and apply them everywhere. Alert titles: sentence style for full sentences, title style for fragments.                                                                                                                                                  | Consistency reads as one product; the alert and button casing are HIG rules, not house style.                           |
| LOC-1 | Localize layout, not just strings: SF tracking applies to Latin/SF text only, never CJK; CJK font fallbacks; full-width punctuation; no title case in Chinese or Japanese; room for expansion; RTL via logical properties and mirrored directional symbols.                                                         | Latin-only defaults squeeze CJK text, mis-punctuate it, and break right-to-left layouts.                                |

## Contents

1. Design principles
2. Layout
3. Color: roles, on-color, token map
4. Typography
5. SF Symbols
6. Interface icons and images
7. Motion and haptics (pointers)
8. Accessibility: hit targets, contrast, settings
9. Writing, capitalization, and inclusion
10. Localization, CJK, and RTL
11. Dark Mode
12. Platform differences
13. Sources

---

## 1. Design principles

**HIG design principles (reintroduced June 8, 2026).** Use these to break ties between competing priorities.

| Principle      | Motto                               | In practice                                                                                                                                  |
| -------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Make something meaningful           | Find the core use and make those features great. Don't re-create existing solutions.                                                         |
| Agency         | Let people do things their own way  | Get people to the task quickly. Avoid locked flows and modes, and make guided flows skippable. Make actions undoable and recovery easy.      |
| Responsibility | Act in people's best interest       | Explain permission requests, collect only what you need, and protect data.                                                                   |
| Familiarity    | Build on what people know           | Use standard patterns and components. Keep behavior consistent, and give clear feedback about state.                                         |
| Flexibility    | Adapt to diverse contexts and needs | Treat accessibility as a day-one concern. Preserve context across sizes and devices, support many inputs, and give each platform equal care. |
| Simplicity     | Be clear and direct                 | Simplicity isn't minimalism: include only what's necessary, be concise, and build hierarchy through order, spacing, and contrast.            |
| Craft          | Care about every detail             | Precise wording, alignment, and animation. Iterate, and keep the product current with the platform.                                          |
| Delight        | Make it human                       | Choose the emotion you want to evoke, and create defining moments. Delight is not decoration.                                                |

**Design-system themes (WWDC25 Platforms State of the Union):**

- **Hierarchy.** Controls float in a distinct glass layer above content (GL-1).
- **Harmony.** Software geometry matches the hardware's curvature (concentricity, GL-6).
- **Consistency.** One anatomy per component across platforms, adapted per device.

The old iOS 7 triad of **clarity, deference, and depth** still describes the spirit: legible content, UI that stays out of the way, and layering that shows structure. It is no longer the headline framing.

**Branding (HIG Branding; WWDC26).** Express the brand in the **content layer**, through imagery, color, typography, voice, and motion. Keep navigation standard, and make custom components earn their cost. Resist showing your logo throughout the app unless it's essential for context. Apple's WWDC26 example shows it once, on the Home tab, fading as content scrolls.

## 2. Layout

**Hierarchy**

- Put the most important content first in reading order: top, then the leading edge. Standard components mirror automatically for right-to-left languages (LOC-1).
- Show relationships with alignment and indentation. Group with negative space, container shapes, or separators. Use progressive disclosure (disclosure, menus, nested views) to keep screens calm.
- Controls and bars float in the glass layer above content (GL-1), separated from it by the scroll edge effect rather than solid bar backgrounds (GL-7). When a sidebar or inspector would cover a hero image, a background extension effect mirrors and blurs the image beneath it (liquid-glass.md).

**Adaptivity**

**LAY-1** Lay out by **size class, window width, and safe areas, never by device idiom or orientation**. Keep functionality identical across sizes and change only how much is visible; for example, a tab bar at compact width can become a sidebar at regular width. Why: windows now resize freely, so device and orientation checks break.

- Handle size classes, screen sizes, orientation, the Dynamic Island, external displays, Display Zoom, resizable windows, text size, and locale (LOC-1).
- **In iOS 27, iPhone apps are resizable** on iPad and in iPhone Mirroring. On iPadOS, windows resize fluidly to arbitrary sizes. **iPhone Duo** (the folding iPhone, fall 2026) has a compact outer display, a regular inner display, and a vertical control rail on the outer display and the inner display in landscape (placement: liquid-glass.md). Use size classes and safe areas, and avoid fixed widths.
- Test the smallest and largest layouts first, including the largest accessibility text size. Xcode 27's Device Hub app and Xcode Previews have a resize mode for this. Then test iPhone Mirroring and iPad on real devices.

**Size classes (iOS/iPadOS)**

| Context                               | Horizontal        | Vertical |
| ------------------------------------- | ----------------- | -------- |
| iPhone portrait                       | Compact           | Regular  |
| iPhone landscape (most models)        | Compact           | Compact  |
| Large iPhone landscape (Plus/Max)     | Regular           | Compact  |
| iPad full screen (either orientation) | Regular           | Regular  |
| iPad narrow split / Slide Over        | Compact           | Regular  |
| iPhone Duo outer / inner display      | Compact / Regular | per pose |

**Safe areas, margins, and spacing**

- Lay out inside **safe areas**, which account for the status bar, Dynamic Island, home indicator, and bars. Let **backgrounds and scrolling content** extend under bars. Keep **controls and critical text** inside the safe area.
- iPhone Duo **reserved regions** (the outer camera, the inner camera when active, and the fold) are a separate concept, in addition to safe areas. Keep content clear of them with the reserved-region APIs (iOS 27.1; swiftui.md).
- **LAY-2** Use the system **layout margins** and **readable content guide** instead of fixed paddings. UIKit's minimum side margin depends on window width, not size class: **16 pt** in windows up to ~402 pt wide, and **20 pt** from 440 pt, even at compact width (measured on iOS 26.3; framework behavior, not an HIG number). An **8 pt grid** (4 pt for fine steps) is a common convention among Apple-style designers, not an HIG rule. Why: matching the framework's margins keeps custom content aligned with system bars, lists, and titles.
- Spacing between controls: HIT-2 (§8).
- macOS: don't put critical controls at the bottom edge of a window, and avoid content behind the camera housing.
- tvOS: inset content **60 pt top and bottom, 80 pt left and right**. Grids use 40 pt horizontal gaps and 100 pt minimum vertical gaps.
- visionOS: center content in large windows. Put supplementary content in a separate window, not an ornament.
- watchOS: at most 2–3 side-by-side controls. Prefer full-width buttons.

## 3. Color: roles, on-color, token map

**COL-1** Use **dynamic system colors by role**. They adapt to light, dark, Increase Contrast, vibrancy, and the glass underneath. Never hard-code system values, because Apple retunes them between releases; the palette was retuned in 26 for Liquid Glass, to improve hue separation. Custom colors need **light, dark, and increased-contrast** variants, even in single-appearance apps, because glass adapts underneath. Every role's name in each medium is in the token map at the end of this section.

**iOS/iPadOS backgrounds.** There are two parallel stacks. Choose one stack per screen and don't mix them.

| Use                       | Plain stack                 | Grouped stack (inset grouped lists, Settings style) |
| ------------------------- | --------------------------- | --------------------------------------------------- |
| Overall view              | `systemBackground`          | `systemGroupedBackground`                           |
| Grouped content within it | `secondarySystemBackground` | `secondarySystemGroupedBackground` (the cells)      |
| Content within secondary  | `tertiarySystemBackground`  | `tertiarySystemGroupedBackground`                   |

In Dark Mode each background has a **base** (dimmer) and an **elevated** (brighter) variant. The system switches to elevated automatically for sheets, popovers, and multitasking, which conveys depth. Use the system colors and you get this for free.

**System hues** (all dynamic, each with light, dark, and increased-contrast variants): red, orange, yellow, green, mint, teal, cyan, blue, indigo, purple, pink, brown, plus `systemGray` … `systemGray6`. Conventional meanings are red for destructive or errors, green for success, orange or yellow for warnings, and blue for links and default tint. visionOS uses the dark variants.

**macOS names to know:** `labelColor` (plus secondary, tertiary, and quaternary), `textColor`, `textBackgroundColor`, `windowBackgroundColor`, `underPageBackgroundColor`, `controlColor`, `controlBackgroundColor`, `controlTextColor`, `controlAccentColor` (the user-chosen accent), `selectedContentBackgroundColor`, `unemphasizedSelectedContentBackgroundColor`, `separatorColor`, `gridColor`, `linkColor`, `placeholderTextColor`, `alternatingContentBackgroundColors`, `keyboardFocusIndicatorColor`. The app accent applies only when the user's accent is "Multicolor". Fixed-color sidebar icons keep their color.

**Rules**

- **COL-2** Use **one accent color** for interactivity, and **never carry meaning by color alone**: add a shape, symbol, or text. Don't use the same color for interactive and non-interactive text; every color should mean exactly one thing. Why: a color that means two things means nothing, and color-only cues vanish with red–green or blue–orange confusion, in grayscale, and in glare.
- Don't repurpose semantic colors. For example, don't use `separator` as text or `secondaryLabel` as a background.
- Color on glass (tint only the primary action; bar labels stay monochrome): GL-5.
- Use the system color picker when people choose colors. Test in bright and dim light and with True Tone.

**On-color: text and glyphs on a colored fill**

**COL-3** Choose the label or glyph color for each fill by **measured contrast**: text ≥ 4.5:1, glyphs ≥ 3:1 (CON-1). White is not a safe default. WCAG ratios, computed from the HIG's iOS 26 hex values:

| System hue as fill                      | White on it (light / dark) | Black on it (light / dark) | Label and glyph color                                                                                                          |
| --------------------------------------- | -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Yellow, orange, green, mint, teal, cyan | 1.5–2.3 / 1.4–2.2          | 9.1–13.9 / 9.4–14.9        | **Black** in both appearances. In light mode you can instead darken the fill to its increased-contrast hue, which takes white. |
| Red, pink, purple, blue, brown, gray    | 3.3–4.2 / 3.1–3.6          | 5.0–6.4 / 5.8–6.8          | White for glyphs and for bold or ≥ 18 pt text. Regular text up to 17 pt needs black or a darker fill.                          |
| Indigo                                  | 5.1 / 3.5                  | 4.1 / 6.0                  | White in light mode. In dark mode, white only for glyphs and bold text.                                                        |

- Every light-mode increased-contrast hue measures 4.5–6.1:1 against white. The dark-mode increased-contrast hues are lighter and need black. "Black" means a fixed dark label: `label` itself turns white in Dark Mode.
- **Arbitrary accents:** on any solid color, either black or white reaches at least 4.58:1 (white below a relative luminance of about 0.18, black above). So derive the label from the actual accent in each appearance and in Increase Contrast. Never hard-code white, and never promise contrast for an arbitrary accent ("re-tint with one variable"). If the brand needs white labels, darken the fill until white measures ≥ 4.5:1. A light darkening isn't enough for the six light hues: 82 % of the hue mixed with black still gives white only 2.1–3.4:1. The web kit's on-color tokens are in web.md.
- The same check applies natively, for example to prominent buttons and icon tiles tinted with one of the light hues.

**Token map: one role across media** (iOS names; macOS uses the NSColor names above)

| HIG role (use)                                                      | SwiftUI                                                                                                                                                     | UIKit                                                                                               | CSS variable                                                                                                          | Tailwind                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `label` (primary text)                                              | `.primary`                                                                                                                                                  | `.label`                                                                                            | `--label`                                                                                                             | `text-label`                                                                                                        |
| `secondaryLabel` (subtitles, metadata)                              | `.secondary`                                                                                                                                                | `.secondaryLabel`                                                                                   | `--secondary-label`                                                                                                   | `text-label-2`                                                                                                      |
| `tertiaryLabel` (hints, disabled look)                              | `.tertiary`                                                                                                                                                 | `.tertiaryLabel`                                                                                    | `--tertiary-label`                                                                                                    | `text-label-3`                                                                                                      |
| `quaternaryLabel` (watermarks)                                      | `.quaternary`                                                                                                                                               | `.quaternaryLabel`                                                                                  | `--quaternary-label`                                                                                                  | —                                                                                                                   |
| `placeholderText` (field placeholders)                              | `Color(.placeholderText)`                                                                                                                                   | `.placeholderText`                                                                                  | `--placeholder-text`                                                                                                  | —                                                                                                                   |
| `link` (link text)                                                  | `Color(.link)`                                                                                                                                              | `.link`                                                                                             | `--link` (AA: apple.com's #0066CC / #2997FF); `--link-native` = UIKit's exact value                                   | `text-link`                                                                                                         |
| `separator` (translucent hairlines)                                 | `Color(.separator)`                                                                                                                                         | `.separator`                                                                                        | `--separator`                                                                                                         | `border-separator`                                                                                                  |
| `opaqueSeparator` (dividers that hide what's beneath)               | `Color(.opaqueSeparator)`                                                                                                                                   | `.opaqueSeparator`                                                                                  | `--opaque-separator`                                                                                                  | —                                                                                                                   |
| `systemFill` … `quaternarySystemFill` (fills, thin to large shapes) | `Color(.systemFill)` …                                                                                                                                      | `.systemFill` … `.quaternarySystemFill`                                                             | `--fill`, `--fill-secondary`, `--fill-tertiary`, `--fill-quaternary`                                                  | `bg-fill` (systemFill)                                                                                              |
| Plain background stack                                              | `Color(.systemBackground)` …                                                                                                                                | `.systemBackground`, `.secondarySystemBackground`, `.tertiarySystemBackground`                      | `--system-background`, `--secondary-system-background`, `--tertiary-system-background`                                | `bg-bg` (first only)                                                                                                |
| Grouped background stack                                            | `Color(.systemGroupedBackground)` …                                                                                                                         | `.systemGroupedBackground`, `.secondarySystemGroupedBackground`, `.tertiarySystemGroupedBackground` | `--system-grouped-background`, `--secondary-system-grouped-background`, `--tertiary-system-grouped-background`        | `bg-grouped`, `bg-cell` (secondary)                                                                                 |
| Tint / accent (interactive; default systemBlue)                     | `.tint`, `Color.accentColor`                                                                                                                                | `.tintColor`                                                                                        | `--accent`; text `--accent-text`; filled button `--accent-fill` with `--accent-on`; focus `--focus-ring`              | `text-accent` (`--accent-text`), `bg-accent-fill` + `text-on-accent`, `bg-tint` (`--accent`; fills and glyphs only) |
| System hues                                                         | `Color.red` … `Color.brown`                                                                                                                                 | `.systemRed` … `.systemBrown`                                                                       | `--system-red` … `--system-brown`                                                                                     | `bg-sys-blue`, `bg-sys-green`, `bg-sys-red`                                                                         |
| Grays                                                               | `Color(.systemGray)` … `Color(.systemGray6)`                                                                                                                | `.systemGray` … `.systemGray6`                                                                      | `--system-gray` … `--system-gray6`                                                                                    | —                                                                                                                   |
| Text styles                                                         | `.largeTitle`, `.title` (Title 1), `.title2`, `.title3`, `.headline`, `.body`, `.callout`, `.subheadline`, `.footnote`, `.caption` (Caption 1), `.caption2` | `UIFont.TextStyle`: `.largeTitle`, `.title1` … `.caption1`, `.caption2`                             | `--fs-large-title`, `--fs-title1` … `--fs-caption1`, `--fs-caption2` (with `--lh-*`, `--tr-*`), or the `.t-*` classes | `text-large-title`, `text-title2`, `text-body`, `text-footnote`                                                     |
| Font designs                                                        | `Font.Design`: `.default`, `.rounded`, `.serif`, `.monospaced`                                                                                              | `UIFontDescriptor.SystemDesign` (same cases)                                                        | `--ff-sans`, `--ff-rounded`, `--ff-serif`, `--ff-mono`                                                                | `font-sans`, `font-rounded`, `font-serif`, `font-mono`                                                              |

- SwiftUI's `.secondary`, `.tertiary`, and `.quaternary` are levels of the current foreground style; they match the label colors only when the foreground is the default. `Color(.name)` wraps the UIKit color. Exact API spellings live in swiftui.md.
- CSS names are the web kit's current names. Tailwind names come from web.md's `@theme` bridge; "—" means not bridged yet (use `text-[var(--name)]`).

## 4. Typography

**Families**

- **SF Pro.** The system sans-serif on iOS, iPadOS, macOS, tvOS, and visionOS. It is variable, with **dynamic optical sizes**: Text and Display cuts merge automatically. Weights run Ultralight to Black, and widths include Condensed and Expanded.
- **SF Pro Rounded.** Pairs with soft or rounded UI. Use it for an alternate voice (numbers, playful headings).
- **SF Compact / SF Compact Rounded.** watchOS system fonts. Complications use Compact Rounded.
- **New York.** A serif that pairs with SF, for reading and editorial moments. It is available on iOS, iPadOS, tvOS, watchOS, and visionOS, and on macOS through Catalyst.
- **SF Mono.** For code and tabular alignment.
- There are also script variants: SF Arabic, Armenian, Georgian, Hebrew. For Chinese, Japanese, and Korean, see LOC-1 (§10).
- Don't embed system fonts. Reference them through the platform APIs, such as `Font.Design.default/.rounded/.serif/.monospaced`, or `-apple-system`/`system-ui` on the web.

**Default and minimum text size**

| Platform    | Default | Minimum |
| ----------- | ------- | ------- |
| iOS, iPadOS | 17 pt   | 11 pt   |
| macOS       | 13 pt   | 10 pt   |
| tvOS        | 29 pt   | 23 pt   |
| visionOS    | 17 pt   | 12 pt   |
| watchOS     | 16 pt   | 12 pt   |

**iOS/iPadOS Dynamic Type at the default "Large" size.** "Emphasized" is the weight you get from `.bold()` or `traitBold`.

| Style       | Weight   | Size | Leading | Emphasized |
| ----------- | -------- | ---- | ------- | ---------- |
| Large Title | Regular  | 34   | 41      | Bold       |
| Title 1     | Regular  | 28   | 34      | Bold       |
| Title 2     | Regular  | 22   | 28      | Bold       |
| Title 3     | Regular  | 20   | 25      | Semibold   |
| Headline    | Semibold | 17   | 22      | Semibold   |
| Body        | Regular  | 17   | 22      | Semibold   |
| Callout     | Regular  | 16   | 21      | Semibold   |
| Subheadline | Regular  | 15   | 20      | Semibold   |
| Footnote    | Regular  | 13   | 18      | Semibold   |
| Caption 1   | Regular  | 12   | 16      | Semibold   |
| Caption 2   | Regular  | 11   | 13      | Semibold   |

Scale anchors: Body is 14 pt at xSmall, 17 at Large (default), 23 at xxxLarge, then 28 at AX1 through **53 at AX5**. Large Title goes from 31 to 40 across the standard sizes, reaching 60 at AX5. Caption 2 never drops below 11 pt.

**macOS text styles.** These are fixed. macOS has no Dynamic Type. Note that Headline is **Bold** and Caption 2 is **Medium**, unlike iOS.

| Style         | Weight           | Size / line height | Emphasized        |
| ------------- | ---------------- | ------------------ | ----------------- |
| Large Title   | Regular          | 26 / 32            | Bold              |
| Title 1       | Regular          | 22 / 26            | Bold              |
| Title 2       | Regular          | 17 / 22            | Bold              |
| Title 3       | Regular          | 15 / 20            | Semibold          |
| Headline      | **Bold**         | 13 / 16            | Heavy             |
| Body          | Regular          | 13 / 16            | Semibold          |
| Callout       | Regular          | 12 / 15            | Semibold          |
| Subheadline   | Regular          | 11 / 14            | Semibold          |
| Footnote      | Regular          | 10 / 13            | Semibold          |
| Caption 1 / 2 | Regular / Medium | 10 / 13            | Medium / Semibold |

**Other platforms**

- **watchOS**, default Large size on 40–42 mm devices: Large Title 36, Title 1 34, Title 2 28, Title 3 19, Headline 16 semibold, Body 16, Caption 1 15, Caption 2 14, Footnote 1 13, Footnote 2 12. Leading is size + 2.5.
- **tvOS:** Title 1 76, Title 2 57, Title 3 48, Headline 38, Body 29 (Medium weight), Caption 1 25, Caption 2 23. **tvOS 27 adds Dynamic Type / Large Text.**
- **visionOS** uses bolder Body and Title styles, and adds Extra Large Title 1 and 2 for editorial layouts. Text defaults to white on glass. Prefer 2D text, and billboard labels in space so they face the viewer.

**Tracking.** The system applies tracking automatically. Set it by hand only in mockups or custom renderers. SF Pro values (points):

| Size        | 9     | 11    | 12  | 13    | 15    | 17    | 20    | 22    | 24    | 28    | 34    | 48    | 80  |
| ----------- | ----- | ----- | --- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | --- |
| Tracking pt | +0.17 | +0.06 | 0   | −0.08 | −0.23 | −0.43 | −0.45 | −0.26 | +0.07 | +0.38 | +0.40 | +0.35 | 0   |

The pattern: small sizes open up, 13–22 pt text tightens, and display sizes open slightly again. macOS uses the same values at shared sizes. SF Pro Rounded and New York have their own tables. These values are for SF (Latin) text only, never CJK (LOC-1).

**Rules and current trends**

- **TYP-1** Use **text styles**, not raw point sizes, so Dynamic Type and Bold Text work, and support at least **200 %** enlargement (140 % on watchOS). Test AX1–AX5 with no clipping and minimal truncation. If you use a custom font, implement scaling (`UIFontMetrics` / `relativeTo:`) and Bold Text support yourself. At large sizes, stack horizontal layouts vertically, wrap instead of truncating, grow row heights, keep the hierarchy order, and scale meaningful icons with the text (SF Symbols do this automatically). Why: text styles carry size, leading, tracking, and weight together and scale as a system; fixed sizes break at accessibility sizes.
- Avoid Ultralight, Thin, and Light at text sizes. Prefer Regular, Medium, Semibold, and Bold.
- **TYP-2** Use few typefaces, and build hierarchy through **size and weight first**, then color (secondary label). Never use ALL CAPS for headers. **The new design favors bolder, left-aligned type**, especially in alerts, onboarding, and titles, with large titles that collapse on scroll. iOS 26 **grouped-list section headers** render as 17 pt semibold (Emphasized Body; `.SFUI-Semibold`, weight 0.3) in secondaryLabel, and footers as 13 pt regular (measured on iOS 26.3; list metrics are CMP-7). The system no longer uppercases section headers, so write them in title-style capitalization (Adopting Liquid Glass). Why: weight and size survive translation, Bold Text, and color-vision differences, and uppercase headers now look out of date.

## 5. SF Symbols

**SYM-1** Use SF Symbols for native interface icons, matched to the adjacent text: the same weight, and a symbol scale (not a heavier weight) for emphasis. On the web, use a matching line-icon set, because the SF Symbols license covers Apple-platform apps. Never use symbols in app icons or logos. Why: symbols are drawn to align with SF text, scale with Dynamic Type, and adapt to rendering modes and accessibility settings.

- **Current: SF Symbols 8** (released with the 27 OSes, beta June 2026). It has **over 7,000 symbols** and adds new ones plus semantic "Enhanced Search" in the app. Symbols new in a release aren't available on earlier OS versions.
- **Weights:** 9 (Ultralight to Black), matching SF font weights. Match the symbol weight to the adjacent text.
- **Scales:** small, medium (default), and large, relative to the cap height. Use scale, not weight, to change emphasis next to text.
- **Rendering modes:**
  - **Monochrome.** One color.
  - **Hierarchical.** One color at layered opacities, for depth.
  - **Palette.** Two or more explicit colors.
  - **Multicolor.** Intrinsic meaning colors, such as a green leaf or a red trash slash.

  Since SF Symbols 7, a **gradient** option renders a linear gradient from one color in any mode. It looks best at large sizes.

- **Variable color** represents a changing value from 0–100%, such as signal or volume, by lighting layers at thresholds. Use it for change, not for depth.
- **Variants:** outline (default in toolbars and lists), fill (tab bars, selection, swipe actions), slash (unavailable or off), and enclosed (circle or square, which helps legibility at small sizes). Containers often choose the variant automatically. Language- and script-specific variants (Arabic, Hebrew, Thai, Chinese, Japanese, Korean, Devanagari, and more) swap automatically with the device language.
- **Effects** (this file owns the taxonomy; other files link here):
  - **Appear / Disappear**
  - **Bounce.** A one-shot "it happened".
  - **Scale.** Persistent emphasis.
  - **Pulse.** Opacity, for ongoing activity.
  - **Variable Color.** Cumulative or iterative, for progress or activity.
  - **Replace.** Down-up, up-up, or off-up.
  - **Magic Replace.** Morphs related shapes. It is the default Replace.
  - **Wiggle.** A call to attention.
  - **Breathe.** Opacity plus size, for live status such as recording.
  - **Rotate.** Whole symbol or by layer.
  - **Draw On / Draw Off** (7+). A handwriting-style stroke, for progress or directional meaning.

  Apply them judiciously, and only when the effect's meaning fits (HIG). Timing and Reduce Motion: motion.md (MOT-5). Which effect confirms which outcome: interaction-feedback.md.

- **Custom symbols:** start from an exported template. Annotate layers for the rendering modes and animations. Use the component library for badges and enclosures. Provide accessibility labels. Never modify Apple product symbols.
- **Standard action glyphs** (HIG Icons): Share `square.and.arrow.up`, Delete `trash`, Done `checkmark`, Cancel/Close `xmark`, Add `plus`, More `ellipsis`, Compose `square.and.pencil`, Search `magnifyingglass`, Filter `line.3.horizontal.decrease`, Copy `document.on.document`, Paste `document.on.clipboard`, Undo `arrow.uturn.backward`, Redo `arrow.uturn.forward`, Select `checkmark.circle`, Account `person.crop.circle`, Print `printer`, Attach `paperclip`, Rename `pencil`, Move `folder`, Duplicate `plus.square.on.square`.
- **Menu icons.** Use menu-item icons sparingly: for key actions, locations, devices, visual concepts (rotate, flip), and user content, and only where an icon clearly fits (HIG Menus, June 2026). Within a group, give every item an icon or none. To avoid repeating one icon on related items such as the copy variants (WWDC25 "Get to know the new design system"), put them in their own group. Ambiguous actions like Select or Edit read better as text. In 27, iPad and Mac menu bars hide most item icons by default (WWDC26 Platforms State of the Union and "Modernize your UIKit app"; API in swiftui.md).

## 6. Interface icons and images

**Interface icons**

- Keep them simple and recognizable, using familiar metaphors. Keep size, stroke weight, detail, and perspective consistent across the set. Match the weight of adjacent text.
- Center them **optically**, with padding baked into the asset if needed. Use vector assets (PDF/SVG). Provide selected states only for custom components, since system bars handle selection.
- Use inclusive, gender-neutral figures, and localize any letters. Always provide **accessibility labels**. Don't replicate Apple hardware.
- In bars, symbols are borderless, because the glass group is the container (CMP-4). Prefer symbols to text except where no clear glyph exists.

**Images**

- Ship raster art at every scale the device uses (@2x and @3x on iPhone), or vectors (PDF/SVG) for flat art and glyphs. On the web, use `srcset` or SVG.
- Use Display P3 for rich imagery (16-bit PNG), and check that distinctions visible only in P3 survive on sRGB displays.
- Scale photos and background art to fill and crop. Never stretch, letterbox, or change the aspect ratio.
- Reserve each image's final size and show a neutral placeholder while it loads, so the layout doesn't jump. Thumbnails inside rounded containers use concentric corners (GL-6).
- Label meaningful images for VoiceOver and hide decorative ones. Avoid text baked into images, because it can't scale or be localized.

## 7. Motion and haptics (pointers)

- **Motion** lives in `motion.md`: purpose, springs, gesture tracking, spatial continuity, the Reduce Motion policy, visionOS comfort, and web motion performance (MOT-1…MOT-6; Reduce Motion is MOT-5).
- **Haptics** live in `interaction-feedback.md` (FB-4), with the rest of control feedback. SF Symbol effects stay catalogued in §5.

## 8. Accessibility: hit targets, contrast, settings

**Hit targets and spacing.** Control sizes from HIG Accessibility:

| Platform    | Default control size | Minimum control size |
| ----------- | -------------------- | -------------------- |
| iOS, iPadOS | **44×44 pt**         | 28×28 pt             |
| macOS       | 28×28 pt             | 20×20 pt             |
| tvOS        | 66×66 pt             | 56×56 pt             |
| visionOS    | 60×60 pt             | 28×28 pt             |
| watchOS     | 44×44 pt             | 28×28 pt             |

**HIT-1** Every touch control gets a **hit region of at least 44×44 pt** (60×60 pt in visionOS). HIG Buttons sets this minimum for any input method: finger, pointer, eyes, or remote. The "minimum" column only bounds how small a dense, secondary control may _look_ (28 pt on iOS); extend its hit region to the default with padding or a content shape. macOS pointer targets use the 28×28 pt default, and 20×20 pt at the smallest. tvOS focusable items use 66×66 pt. Measure the tappable box, including any extension, not the drawn shape (method: interaction-feedback.md). Why: a small visual is fine, but a small target is the most common interaction failure, and eyeballing hides it.

**HIT-2** Space controls apart: about **12 pt** of padding around elements with a bezel, and about **24 pt** around the visible edges of borderless elements (HIG Accessibility). In visionOS, keep button centers at least **60 pt** apart. Why: spacing prevents mis-taps as much as size does.

**Contrast minimums** (the WCAG AA values Accessibility Inspector uses; the HIG also acknowledges APCA)

| Text                    | Minimum ratio |
| ----------------------- | ------------- |
| Up to 17 pt, any weight | **4.5:1**     |
| 18 pt and larger        | 3:1           |
| Bold, any size          | 3:1           |

**CON-1** Essential text meets this table. On the web, WCAG's large-text rule replaces the two 3:1 rows: only text ≥ 24 px, or ≥ 18.66 px bold, gets 3:1 (check with `scripts/contrast.py FG BG --size PX [--bold] --wcag`). Glyphs, icons, and control boundaries meet **3:1** (WCAG non-text contrast). The Dark Mode page asks for at least 4.5:1, and **7:1** for custom foreground and background colors, especially in small text. If the default look falls short, it must meet these ratios when **Increase Contrast** is on. Check both appearances. **Secondary and tertiary labels are for supplementary text only**, such as metadata, footers, hints, and disabled text. In light mode, `secondaryLabel` measures about 3.4:1 on white and 3.3:1 on the grouped background, and `tertiaryLabel` and `placeholderText` about 1.7:1, so a placeholder can never be a field's only label. Text people must read to use the screen uses `label`, or the increased-contrast values (secondaryLabel then measures 5.3–6.0:1). In Dark Mode, secondaryLabel passes (5.3–6.4:1) but tertiaryLabel doesn't (2.2–2.5:1). Why: Apple's own secondary colors sit below 4.5:1 in light mode. Treating them as body text fails every footer, and a rule that always fails gets ignored.

**CON-2** Check these pairs in light mode, Dark Mode, and Increase Contrast. Measure composited colors: blend translucent labels and glass over the real background first.

1. **Text and glyphs on glass**, over the worst content that can scroll beneath (a white page, a bright photo). Glass legibility: GL-4 and GL-9.
2. **Label on an accent or tinted fill**: COL-3.
3. **Glyph on a tinted tile or badge**: the COL-3 table.
4. **Link and secondary text on grouped backgrounds.** iOS `link` measures about 4.0:1 on white and 3.6:1 on the light grouped gray. The web kit's darker `--accent-text` reaches 4.6:1 on white but only 4.1:1 on the grouped gray, so web links use `--link` (apple.com's #0066CC / #2997FF: 5.0:1 on the grouped gray, 5.6:1 on the dark cell). Natively, keep essential links on the cell background, make them bold (3:1 applies), or darken them until they pass.

Why: these are the pairs where Apple-style UIs actually fail; the semantic colors cover the rest.

**Checklist**

- **Dynamic Type:** TYP-1.
- **VoiceOver:** labels, hints, traits, and logical order on every control and meaningful image. Icon-only buttons still need a label.
- **Voice Control and Full Keyboard Access:** visible labels that match the accessibility labels, full keyboard navigation, and no overridden system shortcuts. Support Switch Control.
- **Settings to honor:** Reduce Motion and Dim Flashing Lights (motion.md, MOT-5); Reduce Transparency, Increase Contrast, and the Liquid Glass slider (GL-9); Bold Text; Button Shapes / show borders; Smart Invert; Differentiate Without Color (COL-2).
- **Gestures:** every gesture needs an on-screen alternative. Avoid complex multi-finger gestures. Don't auto-dismiss on timers. Always offer playback controls for autoplaying media.
- **Hearing:** captions, subtitles, and transcripts, with visual and haptic equivalents for audio cues.
- **Cognitive:** simple, consistent flows. Support **Assistive Access**: core tasks only, one step per screen, and confirm hard-to-undo actions twice.
- Audit with Accessibility Inspector, and declare support through App Store **Accessibility Nutrition Labels**.

## 9. Writing, capitalization, and inclusion

- **WRI-1** Define a **voice** once from your audience, then vary tone by situation: serious for errors and payments, light for achievements. Pick one capitalization style per element type and apply it everywhere (table below). Why: a consistent voice and casing make the app read as one product, and people already know Apple's casing for buttons, alerts, and section headers from the system.
- Be clear and concise. Use active voice. Labels are **verbs** ("Send", not "Let's do it"). Use device-correct verbs: tap on touch devices, click on Mac.
- Use possessives ("Your Favorites") sparingly, and avoid "we".
- Empty states should explain what the screen is for and give the next step.
- Errors: place them near the problem, don't blame the user, and say how to fix it. "Choose a password with at least 8 characters" beats "Password too short".
- Settings: describe what a setting does when it's **on**. Link directly to a setting instead of describing its path.
- Use placeholder or hint text in fields, and show validation next to the field.

**Inclusion**

- Write for everyone: plain language, no jargon, and no gendered terms (HIG Writing).
- Portray a range of people, and don't assume gender, family structure, ability, or culture in copy, images, or forms. Ask for personal details such as gender only when you need them, with inclusive choices (HIG Inclusion).
- Avoid idioms, humor, and culture-specific imagery that don't translate (LOC-1).

**Capitalization.** HIG Writing asks you to choose a style per element type and use it consistently. The rows below follow Apple's system style; the alert, button, and section-header rows are explicit rules (HIG Alerts, Adopting Liquid Glass). Chinese and Japanese have no letter case (LOC-1).

| Element                                                                                                                          | Style                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons, menu items, segmented-control labels, tab labels, toolbar/window titles, list/form section headers (no longer ALL CAPS) | **Title-style**: capitalize every word except articles, coordinating conjunctions, and short prepositions, and always capitalize the last word. Examples: "Add to Cart", "View All".    |
| Alert informative text, descriptions, footers, explanatory copy, tooltips                                                        | **Sentence-style**, with full punctuation                                                                                                                                               |
| Alert titles                                                                                                                     | Short and specific; never "Error". A complete sentence takes sentence-style capitalization and ending punctuation. A fragment takes title-style and no ending punctuation (HIG Alerts). |
| Alert buttons                                                                                                                    | One or two words describing the result, title-style, no ending punctuation. Use "Cancel" to cancel. Use "OK" only in purely informational alerts, and never "Yes/No".                   |

Append an ellipsis (…) to a menu item only when it needs more input before it completes.

## 10. Localization, CJK, and RTL

**LOC-1** Design every screen for other languages and scripts, not just for translated strings. Why: Latin-only defaults (SF tracking, title case, fixed widths, left and right) squeeze CJK text, mis-punctuate it, and break right-to-left layouts.

- **Tracking.** The SF tracking table is for SF (Latin, Greek, Cyrillic) glyphs. Never apply it to Chinese, Japanese, or Korean text, whose glyphs sit on a full em square with spacing built in. Natively, don't hand-set tracking or kerning on CJK strings. On the web, `letter-spacing` hits every glyph, so reset it to 0 for `:lang(zh)`, `:lang(ja)`, and `:lang(ko)` (web.md).
- **Fonts and leading.** Apple platforms fall back automatically to PingFang (Chinese), Hiragino Sans (Japanese), and Apple SD Gothic Neo (Korean). On the web, add CJK fallbacks after the system stack, for example `"PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", "Microsoft YaHei"`, and set `lang` (`zh-Hans`, `zh-Hant`, `ja`, `ko`) so the browser picks the right regional glyphs. CJK body text wants more leading than the Latin table; about 1.5–1.7 on the web is a common convention.
- **Punctuation and spacing.** In Chinese and Japanese copy, use full-width punctuation — the full-width comma, colon, question and exclamation marks (U+FF0C, U+FF1A, U+FF1F, U+FF01), the ideographic full stop (U+3002), and curly quotes or corner brackets (U+300C, U+300D) — with no spaces around it. Put a space between CJK text and Latin words or numerals, as Apple's own Chinese UI does around product names such as iCloud.
- **Capitalization.** Title and sentence case don't exist in Chinese or Japanese. Keep Latin product names as written (iPhone, Wi‑Fi). For emphasis, use weight, not uppercase or italics.
- **Length and formats.** Translations can be much longer than English (short labels often double), or shorter but taller. Avoid fixed widths, let labels wrap, and test with Xcode's double-length and right-to-left pseudolanguages. Format dates, numbers, currencies, units, and names with locale-aware formatters, never by concatenating strings.
- **Right to left (Arabic, Hebrew).** Lay out with leading and trailing, never left and right. SwiftUI and Auto Layout flip automatically. On the web, use logical properties (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`) with `dir="rtl"`. Mirror directional symbols such as back and forward chevrons, arrows that follow reading order, and progress direction. Prefer the direction-neutral SF Symbols (`chevron.backward`, `arrow.forward`), which flip automatically; on the web, flip custom ones with `:dir(rtl)`. Don't flip logos.

## 11. Dark Mode

- **COL-4** Respect the system setting. **Don't add an app-only appearance setting**; HIG Dark Mode says to avoid one. The exception is an immersive media app that stays dark permanently. A web app adds an override only when the user or product requires one, and only as WEB-6 describes. Why: people choose an appearance once for the whole system; an in-app switch contradicts it, can look broken, and doubles what you must test.
- Dark palettes aren't inversions. Backgrounds get dimmer and foregrounds brighter, and some hues shift. Use semantic colors and asset-catalog color sets with light and dark variants. Never hard-code colors.
- Base vs elevated backgrounds (iOS) convey layering automatically. On macOS with a Graphite accent, windows take on a desktop tint, so custom bezeled components may want slight transparency.
- Soften white-background images in dark contexts. Provide separate light and dark icons only when an outline or edge disappears.
- Test Dark Mode combined with Increase Contrast and Reduce Transparency, both separately and together.
- watchOS and visionOS have no Dark Mode setting. watchOS is dark by default, and visionOS glass adapts to the room.

## 12. Platform differences

|                        | iOS                                                              | iPadOS                                         | macOS                                                                                                    | watchOS                                                  | visionOS                                             | tvOS                                         |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Primary input          | Multi-Touch                                                      | Touch, Pencil, keyboard, pointer               | Keyboard, pointer                                                                                        | Digital Crown, touch, Action button                      | Eyes plus hand pinch, direct touch                   | Siri Remote focus, controller                |
| Viewing distance       | 1–2 ft                                                           | 1–2 ft                                         | 1–3 ft                                                                                                   | ≤1 ft                                                    | Spatial                                              | 8+ ft                                        |
| Main navigation        | Floating bottom tab bar, bottom search                           | Top tab bar that converts to a sidebar         | Glass sidebar, toolbar, menu bar                                                                         | Vertical pages, Crown scroll, corner toolbar buttons     | Vertical tab bar on the leading side, ornaments      | Top tab bar, focus                           |
| Body text              | 17 pt                                                            | 17 pt                                          | 13 pt                                                                                                    | 16 pt                                                    | 17 pt (bolder)                                       | 29 pt                                        |
| Min hit target (HIT-1) | 44 pt                                                            | 44 pt                                          | 28 pt (20 min)                                                                                           | 44 pt                                                    | 60 pt (centers 60 apart)                             | 66 pt                                        |
| Dynamic Type           | Yes                                                              | Yes                                            | No                                                                                                       | Yes                                                      | Yes                                                  | Yes (new in 27)                              |
| Dark Mode              | Yes                                                              | Yes                                            | Yes (plus accent and desktop tint)                                                                       | Always dark                                              | None (glass adapts)                                  | Yes                                          |
| Key idioms             | One-handed reach (controls low), swipe back, sheets with detents | Resizable windows, multitasking, pointer hover | Menu bar holds every command, keyboard shortcuts, resizable windows, no critical UI at the window bottom | Glanceable, under a minute, complications, notifications | Comfort, depth, minimal immersion needed, no haptics | Focus engine, parallax, 60/80 pt safe insets |

Glass behavior per platform: liquid-glass.md.

## 13. Sources

- HIG, Design principles: https://developer.apple.com/design/human-interface-guidelines/design-principles · Branding: https://developer.apple.com/design/human-interface-guidelines/branding
- HIG, What's new: https://developer.apple.com/design/whats-new/
- HIG, Layout: https://developer.apple.com/design/human-interface-guidelines/layout · Designing for iPhone Duo: https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
- HIG, Color: https://developer.apple.com/design/human-interface-guidelines/color · Dark Mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- HIG, Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- HIG, SF Symbols: https://developer.apple.com/design/human-interface-guidelines/sf-symbols · SF Symbols app page: https://developer.apple.com/sf-symbols/
- HIG, Icons: https://developer.apple.com/design/human-interface-guidelines/icons · Images: https://developer.apple.com/design/human-interface-guidelines/images · Menus (menu-item icons): https://developer.apple.com/design/human-interface-guidelines/menus
- HIG, Accessibility (control sizes, spacing, contrast): https://developer.apple.com/design/human-interface-guidelines/accessibility · Buttons (hit region): https://developer.apple.com/design/human-interface-guidelines/buttons
- HIG, Writing: https://developer.apple.com/design/human-interface-guidelines/writing · Alerts (title and button capitalization): https://developer.apple.com/design/human-interface-guidelines/alerts · Inclusion: https://developer.apple.com/design/human-interface-guidelines/inclusion · Right to left: https://developer.apple.com/design/human-interface-guidelines/right-to-left
- HIG, Designing for iOS / macOS / watchOS / visionOS / tvOS: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios (and sibling pages)
- Adopting Liquid Glass (lists and section headers): https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- WCAG 2.2, 1.4.3 Contrast (Minimum) and 1.4.11 Non-text Contrast: https://www.w3.org/TR/WCAG22/
- WWDC25 Platforms State of the Union (hierarchy, harmony, consistency): https://developer.apple.com/videos/play/wwdc2025/102/ · "Get to know the new design system": https://developer.apple.com/videos/play/wwdc2025/356/
- WWDC26 "Principles of great design": https://developer.apple.com/videos/play/wwdc2026/250/ · "Communicate your brand identity on iOS": https://developer.apple.com/videos/play/wwdc2026/251/ · "Prepare your tvOS apps for Dynamic Type": https://developer.apple.com/videos/play/wwdc2026/221/ · "Modernize your UIKit app" (resizing, Device Hub, menu icons): https://developer.apple.com/videos/play/wwdc2026/278/ · Platforms State of the Union: https://developer.apple.com/videos/play/wwdc2026/102/
- Measured on the iOS 26.3 Simulator (framework behavior, not stated in the HIG): UIKit `systemMinimumLayoutMargins` (16/20 pt) and the grouped-list header and footer styles. Contrast ratios: the WCAG 2 formula applied to the HIG's iOS 26 hex values and to the semantic colors' iOS 26.3 runtime values, composited over each background.
