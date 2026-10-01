# Liquid Glass — the material system

Current as of **2026-09-30**: iOS, iPadOS, macOS 27 "Golden Gate", watchOS, tvOS and visionOS **27** (announced at WWDC26 on June 8, 2026, released September 14, 2026). Liquid Glass arrived with iOS, iPadOS, macOS Tahoe, watchOS and tvOS **26** (WWDC25, June 9, 2025); visionOS keeps its own glass (§13). 27 refines Liquid Glass rather than replacing it, so "iOS 26 Liquid Glass" guidance still applies with the changes in §1. This file owns the material. Placement lives in components.md (CMP), motion in motion.md (MOT), control feedback in interaction-feedback.md (FB), color, contrast and hit targets in foundations.md (COL, CON, HIT), and API spellings only in swiftui.md. Labels: (heuristic) is this skill's recommendation where Apple publishes no number; (unverified) means not confirmed in an Apple primary source.

## Rules at a glance

| ID    | Rule                                                                                                                                                                                                 | Why                                                                                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GL-1  | Liquid Glass only for the functional layer (bars, controls, sheets, menus, popovers); content stays opaque and scrolls underneath.                                                                   | Glass marks what you can act on. Glass in the content layer blurs the line between controls and content and muddies the hierarchy.                                                |
| GL-2  | Never glass on glass; group neighboring glass into one container so it shares one sampling region.                                                                                                   | Glass can't sample glass, so stacked layers turn muddy. Grouped glass samples once, can morph, and renders more cheaply.                                                          |
| GL-3  | Glass budget (heuristic; Apple gives no number): system chrome plus at most 2–3 custom floating glass controls per screen; on the web, at most 6 backdrop-filter surfaces per view, chrome included. | Every extra glass control pulls attention off the content. On the web, each backdrop-filter surface also costs GPU compositing.                                                   |
| GL-4  | Regular glass by default; clear only over rich media with ~35 % dimming; never mix regular and clear in one group.                                                                                   | Regular adapts to any backdrop. Clear doesn't adapt, so it needs dimming and bold, bright content. Each variant has its own character and use, so mixing them looks inconsistent. |
| GL-5  | Tint only the single primary action, and tint the glass background, not the label; bar labels and symbols stay monochrome.                                                                           | When everything is tinted, nothing stands out, and colored labels clash with the content scrolling underneath.                                                                    |
| GL-6  | Capsules and concentric shapes: inner radius = outer radius − padding, with a minimum radius as the fallback.                                                                                        | Nested corners share a center with the hardware, so nothing looks pinched or flared.                                                                                              |
| GL-7  | Separate bars from content with the scroll edge effect, never custom bar backgrounds, blurs or dividers; prefer the automatic style (27).                                                            | Custom fills fight the system material. The automatic style is tuned for legibility and picks up 27 improvements for free.                                                        |
| GL-8  | Material ladder: Liquid Glass for the functional layer → standard materials for content-layer overlays → fills and vibrancy on top of glass or materials. Cards stay opaque.                         | Each rung has one job. Skipping a rung produces glass on glass or glassmorphism.                                                                                                  |
| GL-9  | Never rely on a specific transparency: adapt to Reduce Transparency, Increase Contrast, Reduce Motion and the 27 Liquid Glass slider.                                                                | People and settings change how all glass renders, including your custom glass.                                                                                                    |
| GL-10 | Brand color lives in the content layer; glass stays neutral and picks it up from below.                                                                                                              | Solid-colored bars break the material. Color under glass shows through and changes as the content scrolls.                                                                        |
| GL-11 | At rest (first launch, scrolled to top), keep content from colliding with glass controls.                                                                                                            | Intersections at rest add visual noise before anyone has scrolled, and cost legibility.                                                                                           |
| GL-12 | Treat 27 as the baseline: design and test against the current look, not the clearer 26 look.                                                                                                         | 27 glass diffuses more and has a darker edge. Apps adopt it without recompiling, and Xcode 27 builds can't opt out.                                                               |
| ICN-1 | App icons: layered, full-bleed, no baked effects; recognizable in default, dark, clear and tinted appearances.                                                                                       | The system renders highlights and refraction live, and people choose the appearance.                                                                                              |

## Contents

1. Design timeline: what changed when (26 → 26.1 → 27)
2. What Liquid Glass is
3. The two-layer model and the material ladder
4. When to use glass: the budget
5. Variants: regular, clear, tinted, interactive
6. Color on glass
7. Shape: capsules and concentricity
8. Scroll edge effects
9. Bars and sidebars: material behavior
10. Presentations and controls: material behavior
11. Motion
12. Accessibility and user settings
13. Platform notes
14. App icons
15. Implementation pointers
16. Common mistakes
17. Sources

---

## 1. Design timeline: what changed when (26 → 26.1 → 27)

This is the skill's only list of design changes, and other files point here. API and SDK changes live in swiftui.md §2.

**GL-12** Design against the 27 look. Apps built with standard components pick up every 27 refinement automatically, without recompiling. Apps rebuilt with Xcode 27 can no longer opt out of the new design (the compatibility key is covered in swiftui.md §1). The clearer 26-era glass is gone, so don't tune legibility against it.

| Date                 | Release or HIG update                                                                   | Design-relevant change                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jun 9, 2025 (WWDC25) | iOS, iPadOS, macOS Tahoe, watchOS and tvOS **26** (version numbers now follow the year) | Liquid Glass introduced: floating tab bars and toolbars, concentric geometry, scroll edge effects, and layered app icons built in Icon Composer with default, dark, clear and tinted appearances. visionOS 26 keeps its own glass. HIG updated for Liquid Glass. |
| Sep 9, 2025          | HIG                                                                                     | Materials and Motion updated for Liquid Glass.                                                                                                                                                                                                                   |
| Oct–Nov 2025         | **26.1**                                                                                | A Liquid Glass look setting: **Clear** or **Tinted** (more opaque, higher contrast). iOS/iPadOS: Settings › Display & Brightness › Liquid Glass. macOS Tahoe 26.1: System Settings › Appearance (unverified).                                                    |
| Dec 16, 2025         | HIG                                                                                     | Color, Buttons, Toolbars and Tab bars revised for Liquid Glass. Dynamic Type specs gain emphasized weights.                                                                                                                                                      |
| Mar 24, 2026         | HIG                                                                                     | Sheets: button placement in multi-step flows (CMP-5).                                                                                                                                                                                                            |
| Jun 8, 2026 (WWDC26) | **27** announced; macOS 27 is "Golden Gate"                                             | See "What 27 changed" below. HIG: design principles reintroduced; menus, sidebars, scroll views, search, tab bars and app icons revised. Icon Composer 2 and SF Symbols 8 betas.                                                                                 |
| Sep 9, 2026          | HIG                                                                                     | New page, "Designing for iPhone Duo" (see below). Layout and Branding (brand color) refreshed.                                                                                                                                                                   |
| Sep 14, 2026         | **27** ships on every platform (27.0.1 on Sep 28)                                       | Apple's Figma kits for iOS/iPadOS 27 and macOS 27 followed on Sep 17.                                                                                                                                                                                            |

**What 27 changed** (source: WWDC26 Platforms State of the Union, unless noted):

- **Material.** Glass diffuses complex content behind it more. A darkened edge and brighter specular highlights add depth and separation.
- **Liquid Glass slider.** A continuous setting from **ultraclear to fully tinted** replaces Clear/Tinted on iOS 27 and macOS 27. On iOS it's in Settings › Appearance › Liquid Glass: drag right for more tint, left for more clarity. It applies only while Reduce Transparency and Increase Contrast are off. Apple names no intermediate stops. Test both ends (GL-9).
- **Scroll edge.** When content scrolls under floating bars, a uniform toolbar treatment appears across the top. This is the automatic style, which the HIG now prefers. On macOS 27, automatic resolves to hard when free-floating text such as a window title is present (WWDC26 289). See §8.
- **Sidebars (iPad, Mac).** Sidebars run edge to edge and still refract app content and the wallpaper. Sidebar icons regain the app accent color, and the tint can be set per item. On macOS, the selection is semibold and bordered toolbar items over the sidebar adopt glass (289). iPhone apps can opt into a sidebar (WWDC26 278).
- **macOS.** Every window shares one tighter corner radius. Interactive glass bounces subtly on click; use it only on controls and containers of controls (289). The "show borders" setting now reaches macOS too, so adapt custom controls to it (§12).
- **Menus (iPadOS, macOS).** Icons in menu-bar menus are hidden by default; show them only for key actions (State of the Union; 278). Context menus use glass (unverified).
- **Bars.** Navigation bars can minimize on scroll, by default when the system decides (278). Any one tab can be prominent and stays visible when the tab bar collapses; without one, a search tab may get that treatment (278; swiftui.md §2). Visibility priorities decide which toolbar items stay as space shrinks. The HIG now calls the search-tab styles "standard tab" and "button appearance", and WWDC26 292 gets the button look by making Search the prominent tab. Placement: CMP-1, CMP-4, CMP-6.
- **Transitions.** Sheets and navigation can cross-fade instead of sliding, except on macOS (motion.md).
- **Adaptivity.** iPhone apps become resizable on iPad and in iPhone Mirroring. In inactive iPad windows, icons and text dim along with the glass (unverified). tvOS 27 adds Large Text.
- **App icons.** Rendering is sharper, and refraction can be applied selectively per layer in Icon Composer 2, which also previews the icon on earlier releases (§14).

**iPhone Duo**, the folding iPhone (HIG, Sep 9, 2026). Its APIs are iOS 27.1, in beta as of 2026-09-30 (swiftui.md):

- Toolbars (including navigation buttons), tab bars, the status bar and the Dynamic Island sit in a **vertical side rail on the outer display and on the inner display in landscape**. The inner display in portrait keeps standard horizontal bars. In Split View, each app puts its rail on its outer edge. Rails keep their physical side in right-to-left languages.
- Rail order: Back or Close at the top, then the prominent action, then the other items in their original groups. Give every item a title and a symbol, because the system uses the title in overflow. Items with text labels stay in a horizontal bar, so prefer symbols.
- When space runs out, navigation-focused views keep the tab bar and send toolbar items to overflow (the default). Task-focused views minimize the tab bar and keep the toolbar.

## 2. What Liquid Glass is

Apple calls it a **digital meta-material**. It is not an imitation of real glass. It **bends and concentrates light** (lensing) instead of scattering it the way the old blur materials did, and it moves like a light liquid.

- **Lensing and refraction.** Content under the edges visibly warps. This conveys the shape, position and motion of a surface without heavy borders or opaque fills.
- **Specular highlights.** Virtual light sources create highlights that follow the geometry and move on interactions such as lock and unlock. On some surfaces they respond to device motion. Since 27 they are brighter, with a darkened edge (§1).
- **Adaptive shadows.** Shadow opacity rises over busy content such as text and falls over flat light backgrounds, so the element stays separated.
- **Adaptive tint and light/dark flipping.** Small elements such as tab bars, nav bars and buttons flip between light and dark glass depending on what's underneath, and their symbols and text flip too. Large elements such as sidebars and menus adapt but do **not** flip, because a large surface changing mode would be distracting. Large surfaces are also more opaque.
- **Size-dependent thickness.** When glass grows, for example a button morphing into a menu, it behaves like thicker glass: deeper shadows, stronger lensing and softer light scattering.
- **Interaction glow.** Touch lights the glass from within at the fingertip, and the glow spreads to nearby glass.
- **Materialize, don't fade.** Glass appears and disappears by modulating its lensing, not by animating opacity.
- **Morphing.** Controls shape-shift between app states as if they live on one continuous floating plane. A menu "pops open" out of its button.
- **Focus state.** On iPad and Mac, glass recedes when its window is inactive (icons and text in 27: §1).

**Why it matters.** Controls can look nearly weightless and still stay distinct from content. The UI defers to content without losing legibility. The timing and choreography of materializing, morphing and glow are in motion.md, "Liquid Glass motion" (MOT-4).

## 3. The two-layer model and the material ladder

**GL-1** Think of every screen as two layers. Liquid Glass belongs only to the top one.

| Layer                                   | Contains                                                                                      | Material                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Functional / navigation layer** (top) | Tab bars, toolbars and nav bars, sidebars, floating controls, sheets, popovers, menus, alerts | Liquid Glass                                                                  |
| **Content layer** (bottom)              | Lists, tables, cards, articles, media, maps, canvases, app backgrounds                        | Opaque content. Standard materials only where content needs structure (GL-8). |

- Content runs **edge to edge** and scrolls **under** the floating glass. Extend full-screen backgrounds beneath sidebars, toolbars and tab bars.
- The one exception to "no glass in content" is a slider or toggle knob that lifts into glass while it's being dragged (§10).
- **GL-11** At a resting state, such as first launch or scrolled to top, avoid content visually colliding with glass controls. Reposition or scale the content so the default view is clean.

**GL-8** The material ladder. Use the lowest rung that does the job.

| Rung | Material                                                           | Use for                                                                                                                                                                                                                                | Never                                                     |
| ---- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1    | **Liquid Glass**, regular or clear (§5)                            | The functional layer                                                                                                                                                                                                                   | Content, cards, page backgrounds                          |
| 2    | **Standard materials**: ultra-thin, thin, regular (default), thick | Structure inside the content layer: overlays that partly cover content, or a background that should let content show through. Thicker materials are more opaque and suit text and fine detail. Thinner ones keep more context visible. | Bars and controls (those take glass), or stacked on glass |
| 3    | **Fills and vibrancy**: vibrant label, fill and separator colors   | Text, symbols, inner shapes and separators on top of glass or a material, so they read as part of that surface                                                                                                                         | A blur of their own                                       |

- **Cards, list sections and tiles are content.** Give them opaque grouped fills (COL-1), not glass and not a material. A material on every card is glassmorphism: it costs legibility and competes with the real glass layer.
- On glass, system label colors turn vibrant automatically. On standard materials, use the vibrant label, fill and separator colors, and avoid the quaternary level on thin and ultra-thin materials because its contrast is too low. Hard-coded colors never adapt.
- Choose a material for its meaning, not for the color it seems to give, because system settings change its appearance.
- macOS has several purpose-named materials, vibrancy, and two blending modes (behind window and within window). visionOS has its own glass (§13). Native names for every rung are in swiftui.md.

## 4. When to use glass: the budget

**Use it for:**

- System bars and navigation. You get these for free from standard components.
- A small number of the **most important** custom floating controls, such as a map's locate button or a player's transport controls.
- Transient interactive states, such as a knob while it's dragged (§10).

**GL-3** The budget is system chrome plus at most **2–3 custom floating glass controls** per screen (heuristic). Apple gives no number. It asks you to use glass sparingly and only for the most important functional elements, because every extra glass control pulls attention off the content. On the web, the ceiling is **6 backdrop-filter surfaces** per view, chrome included, because each one costs GPU compositing (web.md WEB-3).

**Don't use it for:**

- **Content** (GL-1). Table views, cards, list rows, text blocks and app backgrounds are not glass.
- **Decoration.** Every glass element should be interactive or navigational. Don't add glass to look modern.
- **Custom bar backgrounds** (GL-7).

**GL-2** Never put glass on glass, such as a glass button in a glass toolbar or a glass card on a glass sheet. Glass can't sample glass, so the result turns muddy and confusing. For elements _on_ a glass surface, use fills, transparency and vibrancy (GL-8). Group nearby custom glass elements into **one container**, so they share sampling, can morph into each other and render efficiently (swiftui.md §4).

## 5. Variants: regular, clear, tinted, interactive

| Variant                                  | Behavior                                                                                                                           | Use when                                                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Regular** (default)                    | Fully adaptive. It blurs and adjusts the luminosity of what's behind it, flips light/dark, and works at any size over any content. | Almost always. It's required for text-heavy surfaces such as alerts, sidebars and popovers, and anywhere legibility could suffer.                                                                                                        |
| **Clear**                                | Permanently more transparent and **not adaptive**. It lets rich media show through.                                                | Only when **all three** hold. (1) The element floats over **media-rich** content such as photos, video or maps. (2) A dimming layer won't harm that content. (3) The content on the glass is **bold and bright**, such as white symbols. |
| **Tinted** (either variant plus a color) | A color maps to a range of tones that shift with the brightness underneath, like stained glass. It stays translucent.              | To emphasize **one** primary action or status (GL-5). The system uses it for prominent buttons such as Done.                                                                                                                             |
| **Interactive**                          | Scales, bounces and shimmers on touch. On macOS 27 it bounces on click.                                                            | Only on controls and containers of controls, never on static surfaces. Press behavior: interaction-feedback.md (FB-1, FB-3).                                                                                                             |

**GL-4** Use regular by default and clear only when all three conditions hold. **Never mix regular and clear** in the same group or bar, because each has its own character.

- **Clear glass needs a dimming layer.** Over bright content, add a dark dimming layer at about **35 % opacity** behind the clear element. Over already-dark content, or with standard AVKit playback controls, which bring their own dimming, you can skip it. For small elements, dim a local spot instead of the whole scene.
- The Liquid Glass setting and accessibility settings change how both variants render (GL-9).

## 6. Color on glass

**GL-5** By default glass has **no color of its own**. It takes color from what's behind it. Labels and symbols on bars stay **monochrome** and flip dark/light to maximize contrast. To emphasize a primary action, put color on the **glass background** (a prominent, tinted button), not on the symbol or text. Tint **one** element, such as Done, Checkout or Start. When everything is tinted, nothing stands out.

- Use the built-in tinting. A **solid opaque fill** on a "glass" button breaks the material and reads as a sticker.
- If your content is colorful, keep bar labels monochrome or pick an accent that clearly differs from the content's hues. Similar hues in labels and backgrounds kill legibility. If your content is mostly monochrome, the brand color works well as the app accent (COL-2).

**GL-10** Put brand color in the **content layer**, not on the bars. Apple's WWDC26 branding session says to move the solid color that used to fill toolbars and tab bars into the content or scroll view. Glass controls then pick up the color dynamically, and it scrolls away with the content.

Custom colors on or under glass need light, dark and increased-contrast variants, even in single-appearance apps, because glass adapts underneath (COL-1). Check text on glass against its worst-case backdrop (CON-2).

## 7. Shape: capsules and concentricity

The hardware's rounded corners set the geometry for the software. Shapes nest around a **shared center**, so corners never look pinched or flared.

| Type           | Radius                              | Typical use                                                                                                    |
| -------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Fixed**      | A constant radius                   | Standalone elements with no container relationship                                                             |
| **Capsule**    | Half the element's height           | Buttons, bars, sliders, switches, search fields and iOS grouped-list sections. It's the signature touch shape. |
| **Concentric** | Parent radius minus padding (inset) | Anything nested in a container: artwork in a card, buttons in a sheet, controls near window or screen corners  |

- **GL-6** Inner radius = outer radius − inset. If the result would be ≤ 0 or too small, use a **fallback minimum radius**, so the same component is concentric when nested and still rounded when it stands alone. The closer a view sits to its container's corner, the more its radius should match (WWDC26 289).
- **Near device edges:** on iPhone, use a **capsule with extra margin** from the screen edge. On iPad and Mac, use a **concentric** shape aligned to the window corner.
- **Density:** capsules suit touch UI. In dense macOS layouts, Mini, Small and Medium controls stay **rounded rectangles**. **Large** controls are capsules, and the macOS **X-Large** size uses glass for emphasis in spacious areas (WWDC25 356).
- Sheets, popovers, menus, list sections and windows all got larger, rounder corners in 26. In macOS 27, every window uses the same, tighter radius (§1).
- Keep optical balance. Center views mathematically when that looks right, and offset them slightly when it doesn't.
- Implementation: swiftui.md §5.7 (SwiftUI), §7 (UIKit) and §8 (AppKit). On the web, compute radii from the parent radius and padding (web.md).

## 8. Scroll edge effects

**GL-7** Separate bars from content with a scroll edge effect: the soft dissolve or blur under floating bars where scrolling content meets the glass. It **replaces hairline dividers and opaque bar backgrounds**. Remove the solid, semi-opaque, blurred or bordered backgrounds you previously added to nav bars, tab bars, toolbars, split views, sheets and popovers. They fight the system material and the scroll edge effect.

- It's **functional, not decorative**. It doesn't block or darken like an overlay. Only use it where a scroll view sits **behind floating UI**.
- Styles:
  - **Automatic** (default, preferred). Since 27 it gives a **more opaque, uniform treatment** for top toolbars with many controls, for text outside glass controls (titles) and for pinned table headers. On macOS 27 it can resolve to hard (§1).
  - **Soft.** A gradual fade, which switches to a subtle dimming when the glass has gone dark. If you force soft, test legibility thoroughly, because it no longer matches the 27 default.
  - **Hard.** A uniform, opaque boundary across the bar plus any pinned accessory, such as column headers. It suits interactive text, controls without backgrounds and pinned headers, and is common on macOS.
- **One effect per view.** Don't stack or mix styles. In split views each pane can have its own effect, but keep their heights aligned.
- Custom bars that float over scroll content must register with the system effect, or their text sits directly on content (swiftui.md §5.6 and §7).

## 9. Bars and sidebars: material behavior

Placement, item counts, the primary action, symbols vs text, and titles are component rules. See components.md: CMP-1 (the tab bar navigates, toolbars act), CMP-2 (one prominent action), CMP-4 (toolbars) and CMP-6 (search). This section covers only what the glass does.

- **Bars float.** Tab bars, toolbars and nav bars are glass capsules above the content, which scrolls underneath (GL-1). Items in one group share one glass background (GL-2). Small bars flip light/dark with the content (§2).
- **Minimizing.** Tab bars (26) and navigation bars (27) can collapse on scroll and return on reverse scroll, a tab tap or scroll to top. A tab bar's bottom accessory then moves inline. Rules are in components.md; motion is in motion.md, "Liquid Glass motion".
- **Sidebars** are large glass. They adapt but don't flip, and they're more opaque than small glass (§2). Since 27 they run edge to edge on iPad and Mac (§1). Structure: components.md.
- **Content under the sidebar.** Let hero images and backgrounds continue beneath it, either by scrolling horizontally or with a **background extension effect**, which mirrors and blurs the adjacent content. Keep text and controls out of the mirrored zone (swiftui.md §3, §7, §8).
- **iPhone Duo side rail:** §1.

## 10. Presentations and controls: material behavior

- **Morph from the source.** Menus, popovers, alerts and action sheets grow out of the glass control that presents them, automatically for system presentations; action sheets no longer rise from the bottom edge. Anchor every presentation to its source, and apply glass to the control itself, not to its subviews. Sheets can morph out of a bar button too (MOT-4; swiftui.md §5.5). Glass that grows behaves like thicker glass (§2).
- **Sheets.** Partial-height sheets float as inset glass. Dragged to full height, they become more opaque and anchor to the screen edge. Pair a sheet for an **interrupting** task with a dimming layer. A sheet for a **parallel** task can be nonmodal glass without dimming. Remove custom backgrounds from sheets and popovers (GL-7). Detents, the grabber and button placement: CMP-5.
- **Controls.** Toggles, sliders and segmented controls rest in the content layer. The knob or thumb **lifts into glass only while it's dragged**, so you can see the value underneath through the lens. It's the one sanctioned glass in the content layer. Press and drag feedback: interaction-feedback.md (FB-1, FB-3).
- **Lists and forms** are content, not glass. Row metrics and section headers: CMP-7.

## 11. Motion

Glass motion (the elastic response, morphing, materializing, minimizing bars, behavior under Reduce Motion) is owned by motion.md, section "Liquid Glass motion". Things morph from their source and leave the way they came (MOT-4), and Reduce Motion follows MOT-5. §2 here defines only the material properties that motion animates.

## 12. Accessibility and user settings

**GL-9** Never rely on a specific transparency. Standard components adapt to every setting below automatically. Custom glass must be tested against each one, and glass look-alikes that ignore these settings aren't acceptable.

| Setting                                                                                                                                                                          | Effect on Liquid Glass                                                                                 | What you must do                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Liquid Glass look.** 27: slider from ultraclear to fully tinted. 26.1: Clear or Tinted (§1).                                                                                   | Changes glass opacity and tint system-wide, including your custom glass.                               | Check both extremes, and don't hard-code transparency (GL-9).                                                |
| **Reduce Transparency**                                                                                                                                                          | Glass becomes frostier and nearly opaque, hiding more content.                                         | Nothing may depend on seeing content through glass (GL-9).                                                   |
| **Increase Contrast**                                                                                                                                                            | Elements become predominantly black or white with a **contrasting border**.                            | Supply increased-contrast colors (COL-1), don't rely on subtle glass edges alone, and check the CON-2 pairs. |
| **Reduce Motion**                                                                                                                                                                | Lower effect intensity, and no elastic properties.                                                     | Custom motion follows MOT-5.                                                                                 |
| **Show borders.** On iOS, the Button Shapes setting (its API was renamed to show borders); macOS 27 adds its own Show Borders setting (earlier macOS reports Increase Contrast). | Adds visible borders to controls.                                                                      | Adapt custom controls to it (GL-9; API: interaction-feedback.md §9).                                         |
| **Dark Mode**                                                                                                                                                                    | Glass adapts. Small glass flips independently of the system mode, depending on the content underneath. | Test light and dark, each combined with Increase Contrast and Reduce Transparency (GL-9).                    |

## 13. Platform notes

- **iOS:** a floating bottom tab bar, bottom search, and glass bars that minimize on scroll (§9).
- **iPadOS:** the tab bar sits near the **top** and can turn into a sidebar. Windows resize fluidly, iPhone apps become resizable in 27, and inactive windows dim (§1).
- **macOS:** glass toolbars integrated with the title bar, glass sidebars (edge to edge in 27), capsule Large and glass X-Large controls, and hard scroll edge effects under window titles. Toolbar items have no bezel.
- **watchOS:** minimal changes. Toolbar buttons and inline capsule buttons get glass. Use standard toolbars and button styles.
- **tvOS:** glass on navigation, Top Shelf and Control Center. Buttons and image views **adopt glass when focused**. Only Apple TV 4K (2nd generation) and later render it; older devices keep the old look.
- **visionOS:** windows keep visionOS's own non-modifiable **glass** material, separate from Liquid Glass, and the Liquid Glass APIs aren't available there (swiftui.md, NAT-3). There's no Dark Mode, because glass adapts to the surroundings. Prefer translucency to opaque fills. For custom separation, use thin (interactive elements, selections), regular (separating sections) or thick (a dark element on a regular background).
- **Web:** there's no native material. Approximate it with backdrop-filter plus a highlight rim and shadow, stay within the GL-3 ceiling, and follow the same layering rules (web.md WEB-2).

## 14. App icons

**ICN-1** Icons are **layered Liquid Glass objects**. Supply layered, full-bleed artwork with no baked-in effects, and keep it recognizable in every appearance. The system adds specular highlights, refraction, translucency, blur and shadow dynamically.

**Workflow:** draw the foreground layers in your design tool as vectors (SVG/PDF). Use PNG for raster art or mesh gradients. Then build the icon in **Icon Composer**, which ships with Xcode. **Icon Composer 2** (2026) adds per-layer **refraction**, new specular highlight controls, and a preview on earlier OS versions. In Icon Composer you set a solid or gradient background, arrange and group layers, set opacity and glass properties, annotate the appearance variants, and export. tvOS and visionOS still use Xcode image stacks: tvOS uses 2–5 parallax layers, and visionOS uses a background plus 1–2 layers with 3D embossing.

**Appearances (iOS, iPadOS, macOS):** default (light), dark, clear light, clear dark, tinted light and tinted dark. People choose one for their Home Screen. The system generates any you don't supply, and alternate icons need their own dark, clear and tinted variants.

| Platform           | Canvas                          | Mask                                        | Appearances      |
| ------------------ | ------------------------------- | ------------------------------------------- | ---------------- |
| iOS, iPadOS, macOS | 1024×1024 px square, layered    | Rounded rectangle, concentric with hardware | 6 (listed above) |
| watchOS            | 1088×1088 px square, layered    | Circle                                      | —                |
| visionOS           | 1024×1024 px square, 3D layered | Circle                                      | —                |
| tvOS               | 800×480 px, parallax            | Rounded rectangle                           | —                |

Rules:

- Supply **square, unmasked, full-bleed** layers. Pre-masked corners break the highlights and produce jagged edges. Keep the key content **centered**, especially for circular masks.
- **Simple:** a single concept, a few **filled, overlapping shapes**, varied opacity for depth, and a simple solid or gradient background.
- **Don't bake in effects** such as highlights, drop shadows, bevels, blurs or glows. The system's effects are dynamic, and baked ones conflict with them.
- Give foreground shapes crisp edges, not soft or feathered ones. Avoid hairline strokes and sharp corners.
- No text unless it's essential to the brand, no photos, no UI screenshots, and no Apple hardware.
- Keep features **consistent across appearances**. Don't swap elements between variants. Base the dark variant on the light one with subdued colors. Dark, clear and tinted icons are progressively more muted, so they must still read as the same app.
- watchOS: don't use a black background. Color spaces: sRGB, Display P3 and Gray Gamma 2.2.

## 15. Implementation pointers

API names and availability live only in swiftui.md. This file names none.

- Standard components that adopt glass on their own, and the background extension effect: swiftui.md §3.
- Custom glass, glass containers and morphing: swiftui.md §4.
- Glass buttons, toolbars, tabs, search, sheets, the scroll edge effect and concentric shapes: swiftui.md §5.
- UIKit: swiftui.md §7. AppKit, including the macOS 27 click bounce and concentric corners: swiftui.md §8.
- Accessibility settings and environment values: swiftui.md §9. Availability and back-deployment: swiftui.md §12 (NAT-3).
- API changes in the 27 SDK: swiftui.md §2.
- The web glass recipe and web performance: web.md (WEB-2, WEB-3).

## 16. Common mistakes

1. **Glassing the content.** Cards, list rows and page backgrounds made of frosted glass. That's glassmorphism, not Liquid Glass (GL-1, GL-8).
2. **Glass on glass.** A glass button inside a glass toolbar, or a glass card on a glass sheet (GL-2).
3. **Too much glass.** Five custom floating glass widgets on one screen (GL-3).
4. **Clear glass without dimming**, or clear glass over plain or text content where regular belongs (GL-4).
5. **Mixing regular and clear** in one bar or group (GL-4).
6. **Tinting everything**, tinting the symbol instead of the button's glass, or a solid opaque fill on a "glass" button (GL-5).
7. **Brand color painted on the bars** instead of in the content (GL-10).
8. **Keeping old custom bar backgrounds**: solid colored nav bars, hairline dividers, bordered bar buttons. Remove them and let the scroll edge effect do the separation (GL-7).
9. **Stacking scroll edge effects**, or adding one where no floating UI exists (GL-7).
10. **Mismatched radii.** An inner radius equal to the outer radius (it looks flared), or a square button in a capsule bar (GL-6).
11. **Edge-to-edge solid bars** instead of floating glass, or content letterboxed between bars instead of scrolling under them (GL-1).
12. **Presentations that ignore their source**, such as an action sheet rising from the bottom edge (§10).
13. **Hard-coding transparency or blur** that ignores the settings in §12 (GL-9).
14. **Designing to the 26 look.** 27 glass is more diffused and has a darker edge (GL-12).
15. **Icons with baked-in gloss, shadows, pre-masked corners or photos**, or appearance variants that change the artwork (ICN-1).

Component mistakes, such as actions in the tab bar, a text button and a symbol button in one capsule, or the wrong sheet button order, are covered in components.md (CMP-1, CMP-4, CMP-5).

## 17. Sources

- HIG, Materials: https://developer.apple.com/design/human-interface-guidelines/materials
- HIG, What's new (changelog through Sep 18, 2026): https://developer.apple.com/design/whats-new/
- HIG, Color: https://developer.apple.com/design/human-interface-guidelines/color
- HIG, Scroll views: https://developer.apple.com/design/human-interface-guidelines/scroll-views
- HIG, Toolbars, Tab bars, Sidebars, Sheets, Search fields, Menus: https://developer.apple.com/design/human-interface-guidelines/toolbars (and sibling pages)
- HIG, App icons: https://developer.apple.com/design/human-interface-guidelines/app-icons
- HIG, Designing for iPhone Duo: https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
- HIG, Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- Adopting Liquid Glass: https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- WWDC25 "Meet Liquid Glass" (219): https://developer.apple.com/videos/play/wwdc2025/219/ · "Get to know the new design system" (356): https://developer.apple.com/videos/play/wwdc2025/356/ · "Build a SwiftUI app with the new design" (323): https://developer.apple.com/videos/play/wwdc2025/323/
- WWDC26 Platforms State of the Union (102): https://developer.apple.com/videos/play/wwdc2026/102/
- WWDC26 "What's new in SwiftUI" (269), "Modernize your UIKit app" (278), "Modernize your AppKit app" (289), "Communicate your brand identity on iOS" (251), "Design intuitive search experiences" (292): https://developer.apple.com/videos/play/wwdc2026/ followed by the session number
- Apple Newsroom, the new software design (June 2025): https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/ · WWDC26 software announcement: https://www.apple.com/newsroom/2026/06/apple-unveils-next-generation-of-apple-intelligence-siri-ai-and-more/
- apple.com, the Liquid Glass slider and "macOS 27 Golden Gate": https://www.apple.com/os/ios/ · https://www.apple.com/os/macos/
- Apple Support, the iOS 26.1 Clear/Tinted setting: https://support.apple.com/en-us/123075 · iPhone User Guide for iOS 27, the Liquid Glass slider (article iphd6804774e)
