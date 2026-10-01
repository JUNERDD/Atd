# Native implementation guide: SwiftUI (+ UIKit / AppKit) for Liquid Glass

## Rules at a glance

| ID     | Rule                                                                                                                                                                                                                                       | Why                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| NAT-1  | Standard components first: `TabView`, `NavigationStack`/`NavigationSplitView`, `.toolbar`, `.searchable`, `.sheet`, `List`/`Form`, system button styles (§1, §3).                                                                          | They get glass, morphing, minimization and accessibility adaptation for free, and follow each OS release (CMP-1). |
| NAT-2  | Glass goes last: layout and appearance modifiers, then `glassEffect`, then `glassEffectID`/`Union`/`Transition`; nearby glass shares one `GlassEffectContainer` (§4).                                                                      | `glassEffect` captures the view as it is at that point; one container renders in one pass and lets shapes morph.  |
| NAT-3  | Gate with the exact versions in §2 (26 glass, 27 toolbar and tab additions, 27.1 iPhone Duo); gate the modifier, not the screen; keep glass APIs off visionOS (§12).                                                                       | Wrong gates fail to compile or silently drop features; visionOS has no `glassEffect`.                             |
| NAT-4  | No custom bar backgrounds or blur hacks: bar background fills, appearance backgrounds, `UIVisualEffectView` blur, gradients under bars (§1).                                                                                               | They cover the system material and the scroll edge effect (GL-7).                                                 |
| NAT-5  | Floating custom controls attach with `.safeAreaBar(edge:)`, never `.overlay`, and only where CMP-3 and GL-3 allow them (§4.1).                                                                                                             | The bar insets scroll content and extends the scroll edge effect; an overlay covers content and ignores both.     |
| NAT-6  | Leave `scrollEdgeEffectStyle` at automatic; set `.hard` only for a custom bar over dense text or pinned headers (§5.6).                                                                                                                    | Automatic adapts per platform and release, and the HIG prefers it (GL-7).                                         |
| NAT-7  | Taps and state changes animate with `.snappy`, never `.bouncy` (MOT-7). Under Reduce Motion (MOT-5), movement and zoom become `.opacity` with a ~0.2 s ease, glass morphs keep `.smooth`; never a `nil` animation (§4.1, §9).              | People still need to see the state change; only the travel and the overshoot go.                                  |
| NAT-8  | No hard-coded colors, fonts or control metrics: hierarchical styles over glass and materials, text styles, `@ScaledMetric`; labels on tinted fills per COL-3 (§6).                                                                         | The Liquid Glass slider, tints, Increase Contrast and Dynamic Type all change the backdrop and the sizes.         |
| NAT-9  | One prominent action per view or region (CMP-2): `.borderedProminent` in content, `.glassProminent` in bars or floating (CMP-3), `UIBarButtonItem.Style.prominent`, `NSToolbarItem.Style.prominent`; tint only that one (GL-5) (§5.1, §7). | Prominence only works while it's scarce.                                                                          |
| NAT-10 | Content stays opaque: rows and cards use grouped backgrounds and fills, not glass or `.regularMaterial` (GL-1, GL-8) (§11).                                                                                                                | Glass is the functional layer; materials are for content-layer overlays.                                          |
| NAT-11 | Icon-only controls keep a text label (`Label` + `.labelStyle(.iconOnly)`), and hit regions meet HIT-1 (§5.1).                                                                                                                              | VoiceOver, Voice Control and overflow menus read the label; small glyphs miss taps.                               |

Baseline: the 27 SDKs (Xcode 27; the OS 27 releases shipped 2026-09-14) on top of 26 Liquid Glass. This file is the skill's single home for API spellings, availability and SDK deltas; other files point to the §2 API index. Design rules are cited by ID, never restated: foundations.md (COL, CON, HIT, TYP), liquid-glass.md (GL), components.md (CMP), motion.md (MOT), interaction-feedback.md (FB). Every API name was checked on its developer.apple.com symbol page on 2026-09-30. Compiled blocks typecheck against the iOS 26.2 SDK (Xcode 26.3); no 27 SDK was available, so 27-only code is marked "(not compiled: iOS 27 SDK)". Anything not confirmed is marked "(unverified)".

## Contents

1. Adoption and the compatibility key · 2. SDK deltas (26 → 27.1) and **API index** · 3. Standard components · 4. Custom glass, containers, floating controls
2. Buttons, toolbars, tabs, search, sheets (5.5), scroll edge (5.6), concentric shapes (5.7) · 6. Type, symbols, empty states · 7. UIKit · 8. AppKit
3. Accessibility and Reduce Motion · 10. Full example app, 10.1 its 27 additions · 11. Pitfalls · 12. Availability and back-deployment · 13. Sources

Recipes owned elsewhere (not repeated here):

- **motion.md:** springs (`withAnimation`, `animation(_:value:)`), transitions and choreography, `PhaseAnimator`/`KeyframeAnimator`, `contentTransition(.numericText(value:))`, symbol-effect timing, gesture physics, and the full Reduce Motion recipe (MOT-5).
- **interaction-feedback.md §10:** `ButtonStyle` states from `configuration.isPressed`, `sensoryFeedback`, `hoverEffect`, focus, and busy, success and error feedback in place.

## 1. Adoption principle and the compatibility key

**NAT-1** Build with the current Xcode and use standard components: bars, tab bars, sidebars, sheets, popovers, menus, sliders, toggles and buttons pick up Liquid Glass with no code (§3), and the 27 OS releases restyle them further without a recompile. Custom tab bars and toolbars forfeit morphing, minimize-on-scroll, search-tab semantics and accessibility adaptation.

**NAT-4** Delete what fights the system material: `.toolbarBackground(_:for:)` and `.toolbarBackgroundVisibility(_:for:)` fills, `UINavigationBarAppearance`/`UITabBarAppearance` backgrounds, `UIVisualEffectView` blur on bars, popovers or sheets, gradients or dividers under bars, and `.presentationBackground` on partial sheets. They sit on top of the glass and the scroll edge effect.

Don't hard-code control metrics (heights, radii, paddings): 26 controls are taller and rounder, and fixed values break concentricity (GL-6, CMP-7). `List`/`Form` section headers are no longer uppercased; don't force caps (TYP-2).

`UIDesignRequiresCompatibility` (Info.plist Boolean) runs a 26-SDK app in the pre-26 appearance while you review and refine the UI. **The system ignores it when you build for iOS, iPadOS, Mac Catalyst, macOS or tvOS 27 or later**, so never add it to new work.

```xml
<key>UIDesignRequiresCompatibility</key><true/>  <!-- 26-SDK builds only; ignored when building for 27 -->
```

UIKit apps built with the 27 SDK must use the scene-based life cycle, or they fail to launch.

## 2. SDK deltas (26 → 26.1 → 27 → 27.1) and API index

Design changes per release live in liquid-glass.md §1; this is the API side.

- **27: no new SwiftUI glass API.** `Glass` still offers `.regular`, `.clear`, `.identity`, `.tint(_:)` and `.interactive(_:)`; existing glass code needs no change.
- **27: the Liquid Glass slider** (verified: WWDC26 Platforms State of the Union, apple.com/os, iPhone User Guide). On iOS 27 and macOS 27 people set glass anywhere from ultraclear to fully tinted. It has no API: standard components and `Glass` adapt, so never assume a transparency or hard-code colors over glass (NAT-8, GL-9).
- **27 SDK and Xcode 27:** `UIDesignRequiresCompatibility` is ignored and UIKit requires the scene life cycle (§1). `@State` becomes the `State()` macro, which creates a class value only once (this lazy behavior is back-ported to iOS 17 and macOS 14); `ContentBuilder`, a typealias of `ViewBuilder`, replaces type-specific builders such as `ToolbarContentBuilder`. Source breaks: TN3211.
- **27.1 (beta as of 2026-09-30):** iPhone Duo APIs, the rows marked "Duo" below. Duo layout rules: liquid-glass.md.

**API index.** "iOS" includes iPadOS and Mac Catalyst at the same version unless noted; "all" means iOS, macOS, tvOS, visionOS and watchOS.

| API                                                                                                                                                                                                                                                                                                                                                                                                                    | Availability                                          | Notes                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **SwiftUI: glass and materials**                                                                                                                                                                                                                                                                                                                                                                                       |                                                       |                                                                                                                                   |
| `glassEffect(_:in:)`; `Glass` `.regular` `.clear` `.identity` `.tint(_:)` `.interactive(_:)`; `GlassEffectContainer(spacing:content:)`                                                                                                                                                                                                                                                                                 | 26, all but visionOS                                  | Default shape `Capsule`; glass last (NAT-2); one container per cluster, `spacing` = merge distance                                |
| `glassEffectID(_:in:)`, `glassEffectUnion(id:namespace:)`, `glassEffectTransition(_:)` (`.matchedGeometry` `.materialize` `.identity`); `.buttonStyle(.glass)`, `.glass(_:)`, `.glassProminent`                                                                                                                                                                                                                        | 26, all but visionOS                                  | IDs act only in animated hierarchy changes; glass buttons: functional layer or over media (CMP-3)                                 |
| `.buttonStyle(.borderedProminent)`, `.bordered`, `.borderless`, `.plain`                                                                                                                                                                                                                                                                                                                                               | iOS 15 or earlier, all (`.borderless` on tvOS: 17)    | In-content buttons (CMP-3; name map in §7)                                                                                        |
| `backgroundExtensionEffect()`; `safeAreaBar(edge:alignment:spacing:content:)` (`VerticalEdge` and `HorizontalEdge` overloads)                                                                                                                                                                                                                                                                                          | 26, all                                               | Extension once per screen; custom bars (NAT-5); below 26 use `safeAreaInset(edge:)` (15)                                          |
| `scrollEdgeEffectStyle(_:for:)` (`.automatic` `.soft` `.hard`), `scrollEdgeEffectHidden(_:for:)`                                                                                                                                                                                                                                                                                                                       | 26, all but visionOS                                  | Omit for automatic (NAT-6)                                                                                                        |
| `ConcentricRectangle(corners:isUniform:)`, `.rect(corners:isUniform:)`, `containerShape(_:)`                                                                                                                                                                                                                                                                                                                           | 26, all                                               | `Edge.Corner.Style` `.concentric` `.concentric(minimum:)` `.fixed(_:)`                                                            |
| `Material` `.ultraThinMaterial` `.thinMaterial` `.regularMaterial` `.thickMaterial` `.ultraThickMaterial` `.bar` via `.background(_:in:)`; vibrancy through hierarchical styles `.primary` `.secondary` `.tertiary` `.quaternary` (`.quinary`: 16)                                                                                                                                                                     | 15 (macOS 12, watchOS 10); `.bar` not tvOS or watchOS | Content-layer overlays only (GL-8); over a material, any other custom foreground style turns vibrancy off                         |
| **SwiftUI: bars, tabs, search, presentation**                                                                                                                                                                                                                                                                                                                                                                          |                                                       |                                                                                                                                   |
| `tabBarMinimizeBehavior(_:)` (`.automatic`; `.never` `.onScrollDown` `.onScrollUp` iOS only)                                                                                                                                                                                                                                                                                                                           | 26                                                    | Minimizes on iPhone only                                                                                                          |
| `tabViewBottomAccessory(content:)`; `tabViewBottomAccessory(isEnabled:content:)`                                                                                                                                                                                                                                                                                                                                       | iOS 26; `isEnabled:` iOS 26.1                         | Read `\.tabViewBottomAccessoryPlacement` (`.expanded`/`.inline`, optional)                                                        |
| `Tab(value:role:content:)` with `TabRole.search`; `.tabViewStyle(.sidebarAdaptable)`                                                                                                                                                                                                                                                                                                                                   | 18 (macOS 15, visionOS 2)                             | Since 26 the search field replaces the tab bar                                                                                    |
| `ToolbarSpacer(_:placement:)` (`.fixed` `.flexible`), `sharedBackgroundVisibility(_:)`                                                                                                                                                                                                                                                                                                                                 | iOS 26, macOS 26                                      | Split or drop shared glass                                                                                                        |
| `DefaultToolbarItem(kind:placement:)`; `searchToolbarBehavior(_:)` (`.automatic` `.minimize`)                                                                                                                                                                                                                                                                                                                          | 26, all                                               |                                                                                                                                   |
| `Button(role: .close)`, `Button(role: .confirm)` (`ButtonRole`)                                                                                                                                                                                                                                                                                                                                                        | 26, all                                               | Standard sheet buttons                                                                                                            |
| `navigationSubtitle(_:)`                                                                                                                                                                                                                                                                                                                                                                                               | iOS 26, macOS 13                                      |                                                                                                                                   |
| `matchedTransitionSource(id:in:)` + `.navigationTransition(.zoom(sourceID:in:))`                                                                                                                                                                                                                                                                                                                                       | 18; zoom not on macOS                                 | Sheets and pushes grow from their source (MOT-4)                                                                                  |
| `matchedTransitionSource(id:in:)` on `ToolbarContent` and `CustomizableToolbarContent`                                                                                                                                                                                                                                                                                                                                 | iOS 26; not macOS, tvOS, watchOS or visionOS          | Put it on the `ToolbarItem`, not the `Button` inside it, so a sheet zooms out of the bar button (§5.5)                            |
| `Slider` tick marks (automatic with `step:`; `SliderTick`), `neutralValue:`                                                                                                                                                                                                                                                                                                                                            | 26, all but tvOS                                      |                                                                                                                                   |
| `.symbolEffect(.drawOn, isActive:)`, `.drawOff` (`.byLayer` `.individually` `.wholeSymbol`; `.reversed`)                                                                                                                                                                                                                                                                                                               | 26, all                                               | Timing: motion.md                                                                                                                 |
| `ControlSize.extraLarge`                                                                                                                                                                                                                                                                                                                                                                                               | 17                                                    | Same as `.large` except on visionOS                                                                                               |
| `@Animatable` (the `Animatable()` macro)                                                                                                                                                                                                                                                                                                                                                                               | 26 SDK; any deployment target (symbol page: iOS 13)   | Synthesizes `animatableData`; motion recipes: motion.md                                                                           |
| `toolbarMinimizationBehavior(_:for:)` (`ToolbarMinimizationBehavior` `.automatic` `.never` `.onScrollDown` `.onScrollUp`)                                                                                                                                                                                                                                                                                              | 27, all; cases other than `.automatic` iOS only       | Bar: `.navigationBar`; an integrated top tab bar minimizes with it                                                                |
| `toolbarMinimizationSafeAreaAdjustment(_:for:)` (`.automatic` `.enabled` `.disabled`)                                                                                                                                                                                                                                                                                                                                  | 27, all; `.enabled`/`.disabled` iOS only              | `.disabled` keeps full-bleed media still                                                                                          |
| `Tab(_:systemImage:value:role:content:)` with `TabRole.prominent`                                                                                                                                                                                                                                                                                                                                                      | 27, all                                               | One tab; without one, a `.search` tab may get the treatment                                                                       |
| `visibilityPriority(_:)` (`ToolbarItemVisibilityPriority` `.automatic` `.low` `.high`)                                                                                                                                                                                                                                                                                                                                 | iOS 27, macOS 26.1                                    | Last items to overflow                                                                                                            |
| `ToolbarOverflowMenu { }`; `ToolbarItemPlacement.topBarPinnedTrailing`                                                                                                                                                                                                                                                                                                                                                 | iOS 27, visionOS 27                                   | Pinned items overflow only while search is active and space is short                                                              |
| `.navigationTransition(.crossFade)` (`CrossFadeNavigationTransition`); `AnyNavigationTransition(_:)`                                                                                                                                                                                                                                                                                                                   | 27 (`.crossFade` not on macOS)                        | A sheet fades in over the content                                                                                                 |
| `reorderable()` + `reorderContainer(for:isEnabled:move:)`; `swipeActions(edge:allowsFullSwipe:content:onPresentationChanged:)` + `swipeActionsContainer()`                                                                                                                                                                                                                                                             | 27, all but tvOS                                      | Any container, not only `List`                                                                                                    |
| `asyncImageURLSession(_:)`                                                                                                                                                                                                                                                                                                                                                                                             | 27, all                                               | `AsyncImage` caching                                                                                                              |
| `alert(_:item:actions:)`, `confirmationDialog(_:item:titleVisibility:actions:)`                                                                                                                                                                                                                                                                                                                                        | iOS 15, macOS 12                                      | New in the 27 SDK docs but back-deployed: no `#available`                                                                         |
| `\.appearsActive` (environment)                                                                                                                                                                                                                                                                                                                                                                                        | iOS 18, macOS 10.15                                   | Dim custom chrome in inactive iPad and Mac windows                                                                                |
| Duo: `ArrangementView(primary:secondary:)`, `arrangementViewStyle(_:)` (`.automatic` `.split` `.overlay`); `onHingeChange(isEnabled:_:)` (`DeviceHingeContext`, `DeviceHinge`)                                                                                                                                                                                                                                         | 27.1                                                  |                                                                                                                                   |
| Duo: `ReservedRegion`, `GeometryProxy.reservedRegions(kind:options:layoutDirectionBehavior:)` (`.occlusion` `.division`)                                                                                                                                                                                                                                                                                               | 27.1                                                  | Cameras and the fold; separate from safe areas                                                                                    |
| Duo: `\.toolbarVerticalEdge` (`HorizontalEdge?`)                                                                                                                                                                                                                                                                                                                                                                       | 27.1                                                  | An environment value, not a modifier; `nil` where no rail is used                                                                 |
| Duo: `toolbarVerticalBehavior(_:)` (`.automatic` `.disabled`), `toolbarVerticalCompressionBehavior(_:)` (`.automatic` `.prefersToolbarItems` `.prefersTabBar`), `axisBehavior(_:)` on toolbar content (`.automatic` `.horizontalOnly` `.verticalPreferred`)                                                                                                                                                            | 27.1                                                  | Disable the rail only for video players or calculator-like layouts                                                                |
| **UIKit**                                                                                                                                                                                                                                                                                                                                                                                                              |                                                       |                                                                                                                                   |
| `UIGlassEffect(style:)` (`.regular` `.clear`; `isInteractive`, `tintColor`), `UIGlassContainerEffect` (`spacing`); `UIButton.Configuration.glass()` `.prominentGlass()` `.clearGlass()` `.prominentClearGlass()`                                                                                                                                                                                                       | iOS 26, tvOS 26                                       | Glass goes in a `UIVisualEffectView`; children go in `contentView`                                                                |
| `UIButton.Configuration.filled()` `.tinted()` `.gray()` `.plain()`                                                                                                                                                                                                                                                                                                                                                     | iOS 15, tvOS 15                                       | In-content buttons (CMP-3; name map in §7)                                                                                        |
| `UIScrollEdgeEffect` (`topEdgeEffect` and siblings: `style` `.automatic` `.soft` `.hard`, `isHidden`), `UIScrollEdgeElementContainerInteraction`                                                                                                                                                                                                                                                                       | iOS, tvOS, visionOS 26                                |                                                                                                                                   |
| `tabBarMinimizeBehavior` (`UITabBarController.MinimizeBehavior`); `bottomAccessory` (`UITabAccessory`); `UISearchTab`                                                                                                                                                                                                                                                                                                  | 26 (`bottomAccessory` iOS only); `UISearchTab` 18     |                                                                                                                                   |
| `UIBarButtonItem.Style.prominent`, `hidesSharedBackground`, `sharesBackground`; `UINavigationItem.subtitle`; `UIBackgroundExtensionView`                                                                                                                                                                                                                                                                               | iOS 26 (extension view also tvOS, visionOS)           |                                                                                                                                   |
| `cornerConfiguration` (`UICornerConfiguration` `.capsule(maximumRadius:)` `.corners(radius:)`; `UICornerRadius` `.containerConcentric(minimum:)` `.fixed(_:)`)                                                                                                                                                                                                                                                         | iOS, tvOS, visionOS 26                                |                                                                                                                                   |
| `UIView.AnimationOptions.flushUpdates`                                                                                                                                                                                                                                                                                                                                                                                 | iOS, tvOS, visionOS 26                                | Applies pending trait, property and layout updates when the animation context changes                                             |
| `UIBlurEffect.Style` `.systemUltraThinMaterial` through `.systemThickMaterial`, `.systemChromeMaterial`; `UIVibrancyEffect(blurEffect:style:)` (`.label` through `.separator`)                                                                                                                                                                                                                                         | iOS 13, visionOS 1                                    | Content-layer materials (GL-8); never on bars                                                                                     |
| `navigationItem.navigationBarMinimization` (`UIBarMinimization`: `minimizationBehavior` `.automatic` `.never` `.onScrollDown` `.onScrollUp`; `restorationBehavior` `.automatic` `.atScrollEdge`; `safeAreaAdjustment` `.automatic` `.enabled` `.disabled`)                                                                                                                                                             | iOS, tvOS, visionOS 27                                | The WWDC26 session's pre-release spelling doesn't compile                                                                         |
| `UITabBarController.prominentTabIdentifier`; `sidebar.preferredPlacement` (`.automatic` `.sidebar` `.tabBar`)                                                                                                                                                                                                                                                                                                          | iOS 27, visionOS 27                                   | The prominent tab stays visible when the bar collapses; the iPhone sidebar is opt-in                                              |
| `UIMenuElement.preferredImageVisibility` (`.automatic` `.visible` `.hidden`); `UIBarButtonItem.visibilityPriority` (`.low` `.standard` `.high`)                                                                                                                                                                                                                                                                        | iOS, tvOS, visionOS 27                                | Menu-bar icons are hidden by default in 27 on iPadOS and macOS; a SwiftUI opt-in via `.labelStyle(.titleAndIcon)` is (unverified) |
| Duo: `UIView.ReservedRegion`, `reservedRegions(kind:options:)`; `preferredVerticalBarBehavior` (override on `UIViewController`; `.automatic` `.disabled`), `navigationItem.verticalBarCompressionBehavior` (`.automatic` `.prefersBarItems` `.prefersTabBar`), `UIBarButtonItem.axisBehavior` (`UIBarButtonItem.AxisBehavior`), `traitCollection.verticalBarEdge`, `UIArrangementViewController`, `UIHingeInteraction` | 27.1                                                  | Reserved regions: cameras and the fold. UIKit says `.prefersBarItems` where SwiftUI says `.prefersToolbarItems`                   |
| **AppKit**                                                                                                                                                                                                                                                                                                                                                                                                             |                                                       |                                                                                                                                   |
| `NSGlassEffectView` (`contentView` `cornerRadius` `tintColor` `style`), `NSGlassEffectContainerView` (`contentView` `spacing`), `NSBackgroundExtensionView`                                                                                                                                                                                                                                                            | macOS 26                                              |                                                                                                                                   |
| `NSButton.BezelStyle.glass`, `NSToolbarItem.Style.prominent` + `backgroundTintColor`, `NSControl.ControlSize.extraLarge`, `prefersCompactControlSizeMetrics`; `NSScrollEdgeEffectStyle`                                                                                                                                                                                                                                | macOS 26; `NSScrollEdgeEffectStyle` 26.1              | X-Large is new on macOS                                                                                                           |
| `NSVisualEffectView.material` (`.sidebar` `.menu` `.popover` `.headerView` `.sheet` `.windowBackground` `.hudWindow` `.contentBackground` and others)                                                                                                                                                                                                                                                                  | macOS 10.10                                           | Semantic materials for content-layer surfaces                                                                                     |
| `NSGlassEffectView.effectIsInteractive`; `NSView.cornerConfiguration` (`NSViewCornerConfiguration.corners(radius: .containerConcentric)`, `invalidateCornerConfiguration()`); `NSRefreshController`                                                                                                                                                                                                                    | macOS 27                                              | Click bounce for glass behind controls; concentric corners; pull to refresh                                                       |

## 3. SwiftUI: standard components that adopt automatically

**NAT-1** in practice: navigation bars and toolbars (glass items, grouped), `TabView` (floating glass tab bar), `NavigationSplitView` sidebars (floating glass), `.sheet`, `.popover` and `.confirmationDialog` (glass, inset partial sheets), `Menu`, `Slider`/`Toggle`/`Picker` knobs, system `Button` styles, `List`/`Form` (larger rows and radii, CMP-7) and `Alert` adopt on rebuild. Menus, alerts and popovers morph out of their glass source control on their own.

Only these need code:

```swift
// Content that should extend under a sidebar or inspector, mirrored and blurred (once per screen):
Image("hero").resizable().scaledToFill().backgroundExtensionEffect()
// A custom bar (player, filter chips): insets the scroll content and extends the scroll edge effect under it.
ScrollView { rows }
    .safeAreaBar(edge: .bottom) { PlayerBar() }
```

No scroll-edge modifier: standard bars already get the automatic effect (NAT-6, §5.6). `backgroundExtensionEffect()` duplicates, mirrors and blurs the view into the safe-area edges and clips it; Apple asks for discretion (one instance of background content). Put overlays such as titles and buttons after the modifier so only the image extends.

## 4. SwiftUI: custom glass

Custom glass is for a few functional controls floating over content (GL-1, GL-3): maps, media, canvases, or an explicit request (CMP-3). Everything else uses §3. `glassEffect(_:in:)` defaults to `.regular` in a `Capsule`; `.identity` turns the effect off without changing layout, and `.interactive()` adds the press and pointer response that system glass buttons already have.

**NAT-2** `glassEffect` captures the view as it is at that point in the chain, so layout and appearance modifiers come first, glass last, then `glassEffectID`/`glassEffectUnion`/`glassEffectTransition`:

```swift
Label("Desert", systemImage: "sun.max.fill")
    .font(.headline)
    .padding(.horizontal, 16).padding(.vertical, 10)        // 1. layout and appearance
    .glassEffect(.regular.tint(.orange).interactive(),       // 2. glass last: it captures the final bounds
                 in: .rect(cornerRadius: 16))
```

- Shapes: `.capsule` (default), `.circle`, `.rect(cornerRadius:)` or `ConcentricRectangle()` (§5.7); larger surfaces take a rounded rectangle, not a capsule.
- `.clear` only over rich media, with a dimming layer beneath (GL-4). Tint only the primary control (GL-5).
- `.glassEffect(isOn ? .regular : .identity)` toggles glass without relayout.

### 4.1 Containers, morphing and floating controls

Wrap nearby glass in `GlassEffectContainer(spacing:)`: it renders in one pass and lets shapes blend and morph. `spacing` is the distance at which shapes start to merge; a spacing larger than the stack's merges them at rest. Give each shape a `glassEffectID(_:in:)` and change the hierarchy inside `withAnimation`. Nearby shapes use `.matchedGeometry` (the default); shapes farther apart than `spacing` use `.glassEffectTransition(.materialize)`. Use the two consistently.

**NAT-5** Attach floating controls with `.safeAreaBar(edge:)` (26; below 26, `safeAreaInset(edge:)`): scroll content insets and the scroll edge effect extends under them, which an `.overlay` or `ZStack` doesn't do. A floating primary action takes `.glassProminent` only because it floats (CMP-3); on a list screen the primary action belongs in the trailing toolbar instead (§10). A canvas tool cluster that morphs open:

```swift
struct CanvasScreen: View {
    @State private var toolsOpen = false
    @Namespace private var glass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Canvas { _, _ in }                                            // stand-in for the drawing surface
            .ignoresSafeArea()
            .safeAreaBar(edge: .bottom, alignment: .trailing) {
                GlassEffectContainer(spacing: 12) {
                    HStack(spacing: 12) {
                        if toolsOpen {
                            Button("Eraser", systemImage: "eraser") {}
                                .glassEffectID("eraser", in: glass)   // grows out of its neighbor
                        }
                        Button(toolsOpen ? "Close Tools" : "Tools",
                               systemImage: toolsOpen ? "xmark" : "pencil.tip") {
                            withAnimation(reduceMotion ? .smooth : .snappy) { toolsOpen.toggle() }  // NAT-7
                        }
                        .glassEffectID("toggle", in: glass)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .labelStyle(.iconOnly)                             // NAT-11: titles stay for VoiceOver
                    .controlSize(.large)
                }
                .padding(.horizontal)
            }
    }
}
```

Keep to the budget: system chrome plus two or three custom glass controls per screen (GL-3). On iPhone Duo, align custom bars with `\.toolbarVerticalEdge` (§2). `glassEffectUnion(id:namespace:)` merges views with the same ID, shape and variant into one shape at rest, even outside one stack (in a `ForEach`: `.glassEffect().glassEffectUnion(id: i < 2 ? "a" : "b", namespace: ns)`).

## 5. SwiftUI: controls and navigation

### 5.1 Buttons

```swift
// Glass styles are for bars and floating controls (CMP-3); in content use .bordered / .borderedProminent.
Button("Cancel") {}.buttonStyle(.glass)
Button("Save") {}.buttonStyle(.glassProminent)        // the region's one prominent action (NAT-9)
Button("Play", systemImage: "play.fill") {}
    .buttonStyle(.glass(.clear))                      // over media only (GL-4)
    .buttonBorderShape(.circle)                       // .automatic .capsule .circle .roundedRectangle(radius:)
    .labelStyle(.iconOnly)                            // NAT-11
    .controlSize(.large)
```

**NAT-9** One prominent action per view or region (CMP-2), and `.tint(_:)` goes on that action only (GL-5). Glass styles belong to the functional layer or float over media; buttons in content stay `.bordered` or `.borderedProminent` (CMP-3). **NAT-11** Icon-only buttons keep a title (`Button(_:systemImage:)` or a `Label` with `.labelStyle(.iconOnly)`) so VoiceOver and Voice Control can name them, and the hit region stays at least 44 pt (HIT-1). Prefer these styles to a custom `glassEffect` on buttons. Pressed, disabled and busy states: interaction-feedback.md §10.

### 5.2 Toolbars

Each `ToolbarItem` or `ToolbarItemGroup` gets a glass capsule; items in a group share one. Split groups with `ToolbarSpacer`:

```swift
.toolbar {
    ToolbarItemGroup(placement: .topBarTrailing) {
        Button("Filter", systemImage: "line.3.horizontal.decrease") {}
        Button("Sort", systemImage: "arrow.up.arrow.down") {}
    }
    ToolbarSpacer(.fixed, placement: .topBarTrailing)            // visual break between groups
    ToolbarItem(placement: .topBarTrailing) { Button("Add", systemImage: "plus") {} }
    ToolbarItem(placement: .principal) { Text("Synced").font(.subheadline) }
        .sharedBackgroundVisibility(.hidden)                     // no shared glass behind this item
}
```

Group by function (CMP-4): at most three groups, symbols or text but not both in one capsule, a label on every icon. Hide a conditional item by leaving out the whole `ToolbarItem`, not its inner view, or an empty glass bubble remains. `Button(role: .close)` and `Button(role: .confirm)` give the standard sheet buttons. `navigationSubtitle(_:)` adds a second title line. 27 additions (overflow, priority, pinning, minimization): §2 and §10.1.

### 5.3 Tabs

Compiled code: `RootView` in §10 (`Tab(_:systemImage:value:content:)`, `Tab(value: …, role: .search)`, `.tabBarMinimizeBehavior(.onScrollDown)` for iPhone, `.tabViewBottomAccessory { }` for one persistent, glanceable control). Add `.tabViewStyle(.sidebarAdaptable)` so the tab bar becomes a sidebar on iPad and Mac.

- Tabs navigate; toolbars act (CMP-1). The `.search` tab sits apart at the trailing end and swaps the tab bar for a search field when selected. Put `.searchable` on its content (or the `TabView`) and let the system choose placement.
- The accessory sits above the tab bar, or inline when the bar minimizes: read `@Environment(\.tabViewBottomAccessoryPlacement)` (`.expanded`/`.inline`, optional) and show a compact layout inline.
- 27: `Tab("Cart", systemImage: "cart", value: …, role: .prominent)` gives one destination the prominent treatment; without one, a `.search` tab may take it, which is how Search gets its button appearance (WWDC26 292).

### 5.4 Search

- `.searchable(text:)` puts the field top-trailing on iPad and Mac and in the bottom toolbar on iPhone (CMP-6).
- `DefaultToolbarItem(kind: .search, placement: .bottomBar)` places the system search field explicitly.
- `.searchToolbarBehavior(.minimize)`, after `.searchable`, collapses the field to a button until tapped. The cases are `.automatic` and `.minimize` (Apple's own example text says `.minimized`; the symbol is `.minimize`).
- 27: under `.automatic` minimization, iOS navigation bars minimize by default when the view's `searchable` uses the `.toolbarPrincipal` placement.

### 5.5 Sheets: morph out of a toolbar button

Put `.matchedTransitionSource(id: "compose", in: ns)` on the `ToolbarItem` (the `ToolbarContent` overload, iOS 26), not on the `Button` inside it, and `.navigationTransition(.zoom(sourceID: "compose", in: ns))` on the sheet's root view, so the sheet grows out of the bar button and returns into it (MOT-4); `.presentationDetents([.height(240), .medium, .large])` sets its stops. Compiled code: `LibraryScreen` in §10. Partial sheets are inset glass; at `.large` they turn more opaque (CMP-5). Remove custom `.presentationBackground` and inner `UIVisualEffectView`s (NAT-4), and keep content off the rounder corners with the default safe-area padding. Attach `.confirmationDialog` and `.popover` to the control that presents them so the morph anchors there. 27: `.navigationTransition(.crossFade)` fades a sheet in over the content instead (not macOS; §10.1).

### 5.6 Scroll edge effect

**NAT-6** Leave it alone. Scroll views under standard bars get the automatic style, which the HIG prefers; in 27 it gives a more opaque separation for dense top toolbars, text outside glass controls and pinned headers (GL-7). Set a style only on a scroll view under a **custom** bar with dense text or pinned column headers:

```swift
List(rows, id: \.self) { Text($0) }
    .scrollEdgeEffectStyle(.hard, for: .top)      // near-opaque boundary; nil or .automatic is the default
```

Don't force `.soft`; if you use it, test legibility over varied content (HIG). `.scrollEdgeEffectHidden(true, for: .bottom)` removes the effect on an edge where nothing floats. One effect per view, and never your own gradient or blur under a bar (NAT-4).

### 5.7 Concentric shapes

```swift
VStack(alignment: .leading, spacing: 12) {
    ConcentricRectangle(corners: .concentric(minimum: 8), isUniform: true)   // follows the card's corners
        .fill(.quaternary)
        .frame(height: 120)
    Text("Desert").font(.headline)
}
.padding(12)
.background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 24))   // opaque card (NAT-10)
.containerShape(RoundedRectangle(cornerRadius: 24))    // inner radius = 24 − 12 padding (GL-6)
```

Screens, sheets and popovers already provide a container shape, so `ConcentricRectangle` near their corners just works. For shape styles: `.background(.tint, in: .rect(corners: .concentric, isUniform: true))`. Never a fixed 12 pt radius everywhere.

## 6. SwiftUI: type, symbols, empty states, Dynamic Type

**NAT-8** Use text styles (`.font(.title2)`, `.body`, `.headline`) and add weight, not fixed sizes (TYP-1). Over glass and materials use hierarchical styles (`.primary`, `.secondary`), which the system renders vibrant; a custom color turns vibrancy off. No hard-coded `Color.white` or `.black` over glass; labels on tinted fills follow COL-3.

- `@ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 24` for icon frames, paddings and glass control sizes that must grow with Dynamic Type. Let layouts wrap at accessibility sizes (`ViewThatFits`, `@Environment(\.dynamicTypeSize)`).
- SF Symbols: `Image(systemName:)`, `.symbolRenderingMode(.hierarchical)`, `.symbolVariant(.fill)`. Effects: `.symbolEffect(.bounce, value:)`, `.pulse`, `.variableColor`, `.wiggle`, `.breathe` and `.rotate` (18), `.appear`/`.disappear`, `.replace` via `.contentTransition(.symbolEffect(.replace))`, and Draw On/Off (26): `.symbolEffect(.drawOn, isActive:)` and `.drawOff`, by `.wholeSymbol`, `.byLayer` or `.individually` (check the `isActive` direction in a preview). Timing: motion.md; which effect confirms what: interaction-feedback.md.
- Empty and error states: `ContentUnavailableView("No Results", systemImage: "magnifyingglass", description: Text("Try a different term."))` or `ContentUnavailableView.search(text:)`, not hand-built placeholders.

## 7. UIKit equivalents (iOS 26+)

```swift
// Custom glass: a UIVisualEffectView with a glass effect; a container merges nearby glass in one pass
let glass = UIGlassEffect(style: .regular)            // .regular, .clear
glass.isInteractive = true
glass.tintColor = .systemOrange                       // prominence only (GL-5)
let glassView = UIVisualEffectView(effect: glass)
glassView.cornerConfiguration = .capsule()
glassView.contentView.addSubview(label)               // content goes in contentView, never on the effect view
let container = UIGlassContainerEffect()
container.spacing = 20                                // distance at which glass merges
let containerView = UIVisualEffectView(effect: container)
containerView.contentView.addSubview(glassView)
// Buttons
button.configuration = .glass()                       // .prominentGlass(), .clearGlass(), .prominentClearGlass()
button.configuration?.title = "Continue"
// Scroll edge: automatic by default (NAT-6); custom controls over the edge register with it
scrollView.topEdgeEffect.style = .hard                // only for a custom bar over dense text
let edgeInteraction = UIScrollEdgeElementContainerInteraction()
edgeInteraction.scrollView = scrollView; edgeInteraction.edge = .bottom
buttonBar.addInteraction(edgeInteraction)
// Tab bar
tabBarController.tabBarMinimizeBehavior = .onScrollDown
tabBarController.bottomAccessory = UITabAccessory(contentView: accessoryView)
tabBarController.tabs.append(UISearchTab { _ in SearchViewController() })   // iOS 18
// Bar button items: grouping and prominence
navigationItem.rightBarButtonItems = [addItem, .fixedSpace(), filterItem]   // fixed space splits shared glass
addItem.style = .prominent                            // tinted and ungrouped (NAT-9)
filterItem.hidesSharedBackground = true               // ignored inside a multi-item UIBarButtonItemGroup
navigationItem.subtitle = "12 items"
// Corners and background extension
view.cornerConfiguration = .corners(radius: .containerConcentric())
let extensionView = UIBackgroundExtensionView(); extensionView.contentView = heroImageView
```

System bars need no code; remove blur hacks on bars and popovers (NAT-4). To toggle glass, animate `visualEffectView.effect` between `nil` and the glass effect inside `UIView.animate`.

Button material names (which to use where: CMP-3). Content layer: UIKit `UIButton.Configuration.filled()`, `.tinted()`, `.gray()`, `.plain()`; SwiftUI `.borderedProminent` (primary), `.bordered` (secondary), `.borderless` or `.plain` (tertiary). Functional layer (bars, floating controls): UIKit `.glass()`, `.prominentGlass()`, `.clearGlass()`, `.prominentClearGlass()`; SwiftUI `.glass`, `.glassProminent`.

```swift
// (not compiled: iOS 27 SDK)
if #available(iOS 27, *) {
    navigationItem.navigationBarMinimization.minimizationBehavior = .onScrollDown
    navigationItem.navigationBarMinimization.safeAreaAdjustment = .disabled   // full-bleed media stays put
    tabBarController.prominentTabIdentifier = "cart"                          // one destination tab
    addItem.visibilityPriority = .high                                        // last to move to overflow
}
```

iPhone Duo (27.1): override `preferredVerticalBarBehavior` to return `.disabled` only for video players or calculator-like layouts, and use `navigationItem.verticalBarCompressionBehavior` and `UIBarButtonItem.axisBehavior` when the rail runs short (§2).

## 8. AppKit notes (macOS 26+)

```swift
let glass = NSGlassEffectView()
glass.contentView = toolStack                 // embed content in contentView
glass.cornerRadius = 12
glass.style = .regular                        // .clear only over media (GL-4)
let group = NSGlassEffectContainerView()      // merges nearby glass, fewer render passes
group.spacing = 8
group.contentView = glassRow                  // a view hierarchy that contains the glass views
```

- `NSBackgroundExtensionView` (`contentView`, `automaticallyPlacesContentView`) extends content under the titlebar, sidebar and inspector.
- `NSButton.BezelStyle.glass`; `NSToolbarItem.Style.prominent` with `backgroundTintColor` for the one prominent item (NAT-9). Use `NSToolbar` and `NSSplitViewController` (sidebar and inspector items) rather than custom chrome; toolbars share glass per group.
- macOS 26 adds the X-Large `NSControl.ControlSize.extraLarge`, and `prefersCompactControlSizeMetrics` keeps macOS 15 metrics. macOS 26.1 adds `NSScrollEdgeEffectStyle`.
- macOS 27 glass additions: `NSGlassEffectView.effectIsInteractive` (the click bounce; enable it only on glass behind or around controls) and concentric corners through `NSView.cornerConfiguration` (`NSViewCornerConfiguration.corners(radius: .containerConcentric)`; call `invalidateCornerConfiguration()` when it changes). Also new: `NSRefreshController` for pull to refresh.

## 9. Accessibility and environment

Glass adapts on its own; your job is not to fight it (GL-9):

| Setting                                                 | What the system does                        | Your job                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Reduce Transparency (`accessibilityReduceTransparency`) | Glass gets frostier and more opaque         | Custom non-glass translucent surfaces switch to an opaque fill                                                                        |
| Reduce Motion (`accessibilityReduceMotion`)             | Morphing and elastic glass motion tone down | **NAT-7** Substitute, don't delete (MOT-5): movement becomes `.opacity` with a short ease; glass keeps its morph on `.smooth` (MOT-9) |
| Increase Contrast (`colorSchemeContrast == .increased`) | Glass borders and contrast rise             | Increased-contrast variants in the asset catalog (COL-1); don't rely on tint alone                                                    |
| Liquid Glass slider (iOS 27, macOS 27)                  | Anywhere from ultraclear to fully tinted    | Hierarchical foreground styles, never fixed colors over glass (NAT-8)                                                                 |
| Dynamic Type, VoiceOver, Voice Control                  | Icon-only toolbar items rely on labels      | A label on every icon (NAT-11)                                                                                                        |

```swift
/// A custom translucent banner in the content layer (GL-8) that honors the settings above.
struct FilterBanner: View {
    let isShown: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        VStack {
            if isShown {
                Label("3 filters on", systemImage: "line.3.horizontal.decrease")
                    .padding()
                    .background(reduceTransparency ? AnyShapeStyle(Color(.secondarySystemBackground))
                                                   : AnyShapeStyle(.regularMaterial), in: .capsule)
                    .overlay { if contrast == .increased { Capsule().strokeBorder(.secondary) } }
                    .transition(reduceMotion ? AnyTransition.opacity
                                             : .move(edge: .top).combined(with: .opacity))    // NAT-7
            }
        }
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .snappy, value: isShown)
    }
}
```

Test with Reduce Transparency, Reduce Motion, Increase Contrast, the largest Dynamic Type size, light and dark, and both ends of the 27 slider. The motion settings and their APIs (Prefer Cross-Fade Transitions, Auto-Play Animated Images, Dim Flashing Lights, Reduce Bright Effects) are tabulated in motion.md §12.

## 10. Full example app (compiles on the iOS 26 SDK; 27 additions in §10.1)

```swift
import SwiftUI

@main struct DemoApp: App { var body: some Scene { WindowGroup { RootView() } } }

struct Item: Identifiable, Hashable {
    let id = UUID()
    var title: String, symbol: String
    static let samples: [Item] = [.init(title: "Desert", symbol: "sun.max.fill"),
                                  .init(title: "Forest", symbol: "tree.fill"),
                                  .init(title: "Coast", symbol: "water.waves")]
}

enum AppTab: Hashable { case library, favorites, search }

struct RootView: View {
    @State private var tab: AppTab = .library
    @State private var query = ""

    var body: some View {
        TabView(selection: $tab) {
            Tab("Library", systemImage: "books.vertical", value: AppTab.library) { LibraryScreen() }
            Tab("Favorites", systemImage: "heart", value: AppTab.favorites) {
                NavigationStack { List(Item.samples) { Text($0.title) }.navigationTitle("Favorites") }
            }
            Tab(value: AppTab.search, role: .search) { SearchScreen(query: $query) }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory { NowPlayingAccessory() }
    }
}

struct NowPlayingAccessory: View {
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform")
            if placement != .inline { Text("Ambient Loop").font(.subheadline).lineLimit(1) }
            Spacer()
            Button("Pause", systemImage: "pause.fill") {}.labelStyle(.iconOnly)
        }
        .padding(.horizontal)
    }
}

struct SearchScreen: View {
    @Binding var query: String
    var results: [Item] { Item.samples.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) } }
    var body: some View {
        NavigationStack {
            List(results) { Label($0.title, systemImage: $0.symbol) }
                .overlay { if results.isEmpty { ContentUnavailableView.search(text: query) } }
                .navigationTitle("Search")
        }
        .searchable(text: $query, prompt: "Search library")
    }
}

struct LibraryScreen: View {
    @State private var items = Item.samples
    @State private var showCompose = false
    @Namespace private var ns

    var body: some View {
        NavigationStack {
            List(items) { item in
                NavigationLink(value: item) { Label(item.title, systemImage: item.symbol) }
            }
            .navigationTitle("Library")
            .navigationSubtitle("\(items.count) places")
            .navigationDestination(for: Item.self) { Text($0.title).font(.largeTitle) }
            .overlay {                                   // an empty state, not a floating control
                if items.isEmpty {
                    ContentUnavailableView("No Places", systemImage: "tray", description: Text("Tap Add to create one."))
                }
            }
            .toolbar {                                   // the primary action lives here, trailing (CMP-1)
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Filter", systemImage: "line.3.horizontal.decrease") {}
                    Button("Sort", systemImage: "arrow.up.arrow.down") {}
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add", systemImage: "plus") { showCompose = true }
                }
                .matchedTransitionSource(id: "compose", in: ns)   // on the item, not the Button (§5.5)
            }
            .sheet(isPresented: $showCompose) {
                ComposeSheet()
                    .navigationTransition(.zoom(sourceID: "compose", in: ns))
                    .presentationDetents([.height(240), .medium, .large])
            }
        }
    }
}

struct ComposeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    var body: some View {
        NavigationStack {
            Form { TextField("Title", text: $title) }
                .navigationTitle("New Place")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button(role: .confirm) { dismiss() }.disabled(title.isEmpty) }
                }
        }
    }
}
```

Notes: every glass surface here comes from a standard component, with no custom glass and no bar backgrounds (NAT-1, NAT-4). The list has no floating action button: its primary action is the trailing toolbar Add, and the sheet's primary action is Confirm in `.confirmationAction` (CMP-1, CMP-2). The search tab is semantic, the accessory adapts to `.inline`, and the sheet zooms out of the Add button (MOT-4). A screen that legitimately needs floating controls (a map, media or a canvas) uses §4.1's `safeAreaBar` pattern (NAT-5).

### 10.1 27 additions (not compiled: iOS 27 SDK)

Gated so the app keeps a 26 deployment target (NAT-3); drop the checks when it targets 27.

```swift
// (not compiled: iOS 27 SDK)
extension View {   // LibraryScreen: List(items) { … }.minimizingNavigationBar()
    @ViewBuilder func minimizingNavigationBar() -> some View {
        if #available(iOS 27, *) { self.toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar) } else { self }
    }
}
// LibraryScreen's .toolbar: Add stays visible longest; secondary actions live in the overflow menu.
if #available(iOS 27, *) {
    ToolbarItem(placement: .topBarTrailing) { addButton }
        .matchedTransitionSource(id: "compose", in: ns)   // keep the sheet's zoom source (§5.5)
        .visibilityPriority(.high)
    ToolbarOverflowMenu { Button("Export", systemImage: "square.and.arrow.up") {} }
} else {
    ToolbarItem(placement: .topBarTrailing) { addButton }
        .matchedTransitionSource(id: "compose", in: ns)
}
// A lightweight sheet that fades in over the content (not macOS):
.sheet(isPresented: $showFilters) { if #available(iOS 27, *) { FilterSheet().navigationTransition(.crossFade) } else { FilterSheet() } }
// A destination that earns prominence (one per tab bar); without one, Search may get it by default.
if #available(iOS 27, *) {
    Tab("Cart", systemImage: "cart", value: ShopTab.cart, role: .prominent) { CartScreen() }
} else {
    Tab("Cart", systemImage: "cart", value: ShopTab.cart) { CartScreen() }
}
```

## 11. Pitfalls

1. **Glass on content.** Glass is the navigation and control layer above content (GL-1): never glass a list row, a card grid or a whole screen.
2. **NAT-10 Cards made of material.** Cards and rows are opaque grouped fills (`Color(.secondarySystemGroupedBackground)` on `.systemGroupedBackground`), not `.regularMaterial`; standard materials are for content-layer overlays that must hint at what's beneath (GL-8).
3. **Glass on glass, or too much glass.** No glass inside glass, on toolbar items, or on a `.glass` button (GL-2). Siblings share one `GlassEffectContainer`; each loose glass view or extra container costs a render pass (GL-3).
4. **Modifier order.** `.glassEffect().padding()` leaves the glass hugging the content with the margin outside it (NAT-2).
5. **Hard-coded colors and fonts.** `Color.white` over glass breaks under the slider, tints and Increase Contrast; fixed sizes ignore Dynamic Type (NAT-8).
6. **Custom bars, fake blur, forced scroll-edge styles.** Custom bars lose minimize-on-scroll, morphing, search-tab semantics and accessibility; gradients and forced styles fight the edge effect (NAT-1, NAT-4, NAT-6).
7. **Floating action buttons in an `.overlay` or `ZStack`.** They cover rows and ignore insets and the edge effect. Use the toolbar, or `.safeAreaBar` where floating is legitimate (NAT-5, CMP-3).
8. **`.clear` over text, or tint everywhere.** `.clear` needs a dimming layer over media (GL-4); one tinted or prominent action per region (NAT-9).
9. **Hidden toolbar contents.** Hiding the view inside a `ToolbarItem` leaves an empty glass bubble; leave out the item itself.
10. **Ignoring inset partial sheets.** Content peeks beside and below them, and their corners are rounder; check padding (CMP-5).
11. **`reduceMotion ? nil : .bouncy`.** `.bouncy` on a tap breaks the bounce budget (MOT-7), and a `nil` animation hides the state change too; use `.snappy`, and substitute under Reduce Motion (NAT-7).
12. **Stale API names.** WWDC26 session videos used pre-release spellings for the 27 minimization APIs; copy names from §2 only.

## 12. Availability and back-deployment

**NAT-3** Gate only below an API's version, with the exact versions in §2, and wrap the modifier, not the whole screen. With a 26 deployment target, drop the 26 checks. iPhone Duo APIs need `#available(iOS 27.1, *)`; `alert` and `confirmationDialog(_:item:…)` need no check (iOS 15). visionOS has no `glassEffect`, `Glass`, `GlassEffectContainer` or glass button styles; it keeps its own glass (`glassBackgroundEffect(in:displayMode:)`), so multiplatform code branches with `#if os(visionOS)`.

```swift
extension View {
    /// Liquid Glass where it exists, a material on older systems, visionOS glass on visionOS.
    @ViewBuilder
    func glassIfAvailable(in shape: some InsettableShape = Capsule(), interactive: Bool = false) -> some View {
        #if os(visionOS)
        self.glassBackgroundEffect(in: shape)
        #else
        if #available(iOS 26, macOS 26, tvOS 26, watchOS 26, *) {
            self.glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            self.background(.ultraThinMaterial, in: shape)
        }
        #endif
    }

    @ViewBuilder
    func minimizingTabBar() -> some View {        // the minimizing cases exist on iOS only
        #if os(iOS)
        if #available(iOS 26, *) { self.tabBarMinimizeBehavior(.onScrollDown) } else { self }
        #else
        self
        #endif
    }
}

/// A primary action for a bar or a floating control (CMP-3); in content, use .borderedProminent directly.
@MainActor @ViewBuilder func barPrimaryButton(_ title: String, action: @escaping () -> Void) -> some View {
    #if !os(visionOS)
    if #available(iOS 26, macOS 26, tvOS 26, watchOS 26, *) { Button(title, action: action).buttonStyle(.glassProminent) }
    else { Button(title, action: action).buttonStyle(.borderedProminent) }
    #else
    Button(title, action: action).buttonStyle(.borderedProminent)
    #endif
}
```

Fallbacks are for older systems only; on 26 and later, don't substitute materials for glass. `GlassEffectContainer` needs 26 as well: put the container and its fallback (`Group` or plain layout) in one wrapper view. At a glance: 18 for `Tab`, `TabRole.search`, `.sidebarAdaptable`, `matchedTransitionSource` (26 on a `ToolbarItem`) and `.zoom`; 26 for glass, `safeAreaBar`, `ToolbarSpacer`, `tabViewBottomAccessory` (26.1 with `isEnabled:`), `backgroundExtensionEffect` and `scrollEdgeEffectStyle`; 27 for `toolbarMinimizationBehavior`, `TabRole.prominent`, `ToolbarOverflowMenu`, `.topBarPinnedTrailing` and `.crossFade` (`visibilityPriority`: iOS 27, macOS 26.1); 27.1 for iPhone Duo.

## 13. Sources

- Adopting Liquid Glass: https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- Applying Liquid Glass to custom views (modifier order, containers, morphing, performance): https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views
- Landmarks: Building an app with Liquid Glass: https://developer.apple.com/documentation/swiftui/landmarks-building-an-app-with-liquid-glass
- Symbol pages for every §2 row, checked 2026-09-30: developer.apple.com/documentation/{swiftui,uikit,appkit,symbols}/… (JSON: developer.apple.com/tutorials/data/documentation/…)
- SwiftUI, UIKit and AppKit updates (June 2025, June 2026, September 2026): https://developer.apple.com/documentation/updates/swiftui (and /uikit, /appkit)
- HIG Scroll views (June 8, 2026: prefer the automatic scroll edge effect) and Designing for iPhone Duo (September 2026)
- UIDesignRequiresCompatibility: https://developer.apple.com/documentation/bundleresources/information-property-list/uidesignrequirescompatibility
- TN3211: Resolving SwiftUI source incompatibilities for State and ContentBuilder
- WWDC25 323 "Build a SwiftUI app with the new design", WWDC25 284 (UIKit); WWDC26 102 (Platforms State of the Union), 269 (SwiftUI), 278 (UIKit), 289 (AppKit), 292 (search tab)
