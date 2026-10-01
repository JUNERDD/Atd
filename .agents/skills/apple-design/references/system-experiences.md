# System experiences: widgets, Live Activities, notifications, controls

## Rules at a glance

| ID     | Rule                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYS-1  | The system draws the container. Never add your own glass, blur, material, outer card, border or drop shadow to a widget, Live Activity, control, complication or notification.                          | The system supplies the shape, corner radius and margins, and in clear or tinted Home Screens swaps your background for Liquid Glass or a tint. A painted layer becomes glass on glass (liquid-glass.md, GL rules) or a flat tinted slab. |
| SYS-2  | Put a widget's background in `containerBackground(for: .widget)` and keep the foreground readable without it.                                                                                           | StandBy, CarPlay, the Lock Screen, complications and the clear and tinted looks remove or replace it. A nonremovable background keeps the widget out of StandBy and the iPad Lock Screen.                                                 |
| SYS-3  | Design every widget for all three rendering modes (full color, accented, vibrant) and mark the key value `widgetAccentable()`.                                                                          | The person picks the appearance. Accented turns opaque art into white shapes; vibrant turns color into grayscale.                                                                                                                         |
| SYS-4  | Carry meaning without hue: pair color with text or a symbol, and build vibrant hierarchy from opaque grays, not white at partial opacity.                                                               | Tinted, vibrant, tinted watch faces, StandBy at night (red) and Always-On all remove or dim color.                                                                                                                                        |
| SYS-5  | One purpose per surface, readable at a glance: the key value largest, system text styles at 11 pt or more (Live Activities: medium weight or heavier), SF Symbols, and real text, never images of text. | People read these in about a second, at arm's length or across a room. Real text scales with Dynamic Type and is read by VoiceOver.                                                                                                       |
| SYS-6  | Keep the system margins and concentric inner shapes (`ContainerRelativeShape`). In the Dynamic Island, sit content snug to the camera and away from the edge.                                           | The outer shape belongs to the system. Mismatched radii and cramped or drifting content are the fastest tell.                                                                                                                             |
| SYS-7  | A tap deep-links to the exact item. Add App Intent buttons or toggles only for the essential one-step action, few and comfortably sized (foundations.md, HIT rules).                                    | Widgets aren't mini apps. Extra targets crowd the content and cause mis-taps, and CarPlay disables Live Activity buttons.                                                                                                                 |
| SYS-8  | Treat widgets as budgeted snapshots: plan a timeline, let the system render times and timers, show staleness, and move minute-by-minute tracking to a Live Activity.                                    | A frequently viewed widget gets roughly 40–70 reloads a day. Old data dressed as live erodes trust.                                                                                                                                       |
| SYS-9  | Use a Live Activity only for a bounded task or event (8 h at most). Start it when people expect it, update it only on real change, end it as soon as the task ends.                                     | It is the most prominent surface on the device, and misuse makes people switch Live Activities off.                                                                                                                                       |
| SYS-10 | Ship every Live Activity presentation (compact pair, minimal, expanded, Lock Screen) and keep elements in the same relative places across them.                                                         | The system, not you, picks the presentation for each device and moment. Continuity keeps it recognizable.                                                                                                                                 |
| SYS-11 | Interrupt honestly: choose the true interruption level, alert only for updates people must not miss, and never send a push notification and a Live Activity alert for the same event.                   | People silence whole apps that over-interrupt, and the system periodically offers to turn off your Time Sensitive alerts.                                                                                                                 |
| SYS-12 | Treat the Lock Screen, Always-On, watch faces and notifications as public: redact sensitive data and require authentication for actions that affect security.                                           | These surfaces are visible to anyone nearby and reachable on a locked device.                                                                                                                                                             |

Current as of **2026-09-30** (the 27 releases). This file covers surfaces your app feeds but the system draws: widgets, Live Activities and the Dynamic Island, notifications, controls (Control Center, the Lock Screen and the Action button), complications and App Clips. The HIG pages for them predate 27 (latest revision December 2025), so 27 changes here come from WWDC26 sessions and symbol pages. Other owners: glass in liquid-glass.md; type, color, symbols and hit targets in foundations.md; timing in motion.md; permission priming in components.md (PAT-2, PAT-5); in-app SwiftUI in swiftui.md.

## Contents

1 What the system draws for you · 2 Widgets · 3 Live Activities and the Dynamic Island · 4 Notifications · 5 Controls · 6 Complications and the watch Smart Stack · 7 App Clips and App Shortcuts · 8 Common mistakes · 9 Implementation pointers · 10 Sources

## 1. What the system draws for you

A "Liquid Glass widget" is an ordinary widget that looks right in the **clear** appearance. The glass comes from the system; you supply the content.

| Surface                                                              | The system draws                                                                                                                                                       | You supply                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Home Screen and Today widgets (iOS/iPadOS 26+, Mac desktop in Tahoe) | Shape, corners and default margins. **Clear** desaturates your content and adds translucency, highlights and Liquid Glass; **tinted** applies the person's tint color. | Content plus a removable background.                                |
| Lock Screen, StandBy and CarPlay widgets                             | Vibrant monochrome (Lock Screen; StandBy at night in red), or full color with the background removed and scaled up (StandBy, CarPlay).                                 | A foreground that works on its own, over black or a wallpaper.      |
| Dynamic Island                                                       | An opaque black capsule, 44 pt corners concentric with the camera, a key line on dark backgrounds, and the expand and collapse motion.                                 | Compact, minimal and expanded content, plus a key line tint.        |
| Live Activity on the Lock Screen                                     | The platter (light in light mode, dark in dark mode), the dismiss button, and 2× scaling in StandBy.                                                                   | The layout and an optional background tint.                         |
| Notification                                                         | The platter, your app icon or the sender's avatar, grouping, timestamp and action menu.                                                                                | Title, body, actions, sound and interruption level.                 |
| Control                                                              | The tile at each Control Center size, the Lock Screen button, the Action button readout, and the on-state tint.                                                        | A symbol (an on/off pair for toggles), title, value and tint color. |

Mockups in Figma or HTML: draw the system frame once per appearance (full color, clear, tinted, Lock Screen) and keep everything inside it opaque, with no glass of its own. A web page can't use the Dynamic Island, and an app shouldn't add UI that points at it.

## 2. Widgets

**Families.** Offer only the sizes that add value, and don't stretch a small layout to fill a large one. Sizes vary by device and the system scales them, so build with stacks, not fixed frames. Points below are for 393- / 430-pt-wide iPhones.

| Family                                         | Where it appears                                                                                                                                           | iPhone size (pt)                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `systemSmall`                                  | Home Screen, Today view, Mac, Vision Pro; iPhone StandBy and CarPlay; iPad Lock Screen                                                                     | 158×158 / 170×170                   |
| `systemMedium`, `systemLarge`                  | Home Screen, Today view, Mac, Vision Pro                                                                                                                   | 338×158, 338×354 / 364×170, 364×382 |
| `systemExtraLarge`, `systemExtraLargePortrait` | Extra large: iPad, Mac, Vision Pro. Portrait: Vision Pro (26); iOS, iPadOS and macOS (27), where on iPhone it fills a whole Home Screen page (unverified). | —                                   |
| `accessoryCircular`, `accessoryRectangular`    | iPhone and iPad Lock Screen, below the clock; watch complications and Smart Stack                                                                          | 72×72, 160×72 / 76×76, 172×76       |
| `accessoryInline`, `accessoryCorner`           | Inline: one line of text above the Lock Screen clock and on watch faces, with one tap target. Corner: watch faces only.                                    | Inline 234×26 / 257×26              |

**Rendering modes** (`widgetRenderingMode`; SYS-3):

| Mode        | Where                                                                                                             | What the system does                                                                                                                                                                                                                                                                                                                      | What you do                                                                                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullColor` | Home Screen in light or dark, StandBy, CarPlay, Mac, watch Smart Stack and complications, Vision Pro by default   | Draws your views unchanged.                                                                                                                                                                                                                                                                                                               | Brand color, gradients and photos are fine. Use semantic colors or light and dark asset variants.                                                                                                                                                                           |
| `accented`  | Home Screen, Today view and Mac in clear or tinted; tinted watch faces and Smart Stack; Vision Pro color palettes | Replaces your background with Liquid Glass or the tint, splits your views into a primary group and an accent group, and paints each group one solid color (white on iPhone, iPad and Mac; the accent takes the watch-face color). Opaque images become white shapes; gradients and translucent content keep their opacity but turn white. | Mark the key value `widgetAccentable()`. Show photos, gradients and scrims only in full color and fall back to symbols. For images use `widgetAccentedRenderingMode(.desaturated)` or `.accentedDesaturated`; keep `.fullColor` for media art such as album or book covers. |
| `vibrant`   | iPhone and iPad Lock Screen, StandBy at night, Mac desktop                                                        | Desaturates everything. Pixel brightness sets how vibrant content looks over the wallpaper; pixel opacity sets how much blurred background shows through.                                                                                                                                                                                 | Draw at full opacity: white or light gray for primary content, darker opaque grays for secondary.                                                                                                                                                                           |

**Layout and type**

- Default content margins are 16 pt for most widgets and smaller on the Lock Screen, in StandBy and on the Mac desktop; 11 pt suits tight groups of buttons or graphics. Don't pad on top of them. Use `contentMarginsDisabled()` only for full-bleed art, then re-inset text with `widgetContentMargins`. Round inner shapes with `ContainerRelativeShape`.
- Use the system font and text styles (foundations.md, TYP rules), 11 pt minimum, never rasterized; a custom font can carry the big number. Widgets support Dynamic Type from Large through AX5 on iOS, iPadOS and visionOS.
- Balance density: sparse looks pointless, dense isn't glanceable, so go up a size or swap text for a graphic. Brand through color, type and glyphs; add a small logo (top-right corner) only when content comes from several sources. Don't copy the widget's look into your app.
- Always-On iPhones dim the Lock Screen and stop animation: read `isLuminanceReduced` and keep grays legible.

**Interaction and freshness**

- A tap anywhere else opens the app, so point `widgetURL` at the item shown; larger sizes can add a `Link` per row.
- Buttons and toggles run App Intents and must do more than open the app. They work in system families and in circular and rectangular Lock Screen widgets on iPhone and iPad, and wait for authentication on a locked device. A `Toggle` flips optimistically: reconcile the result in `perform()` and show failures. Mark values awaiting a round trip with `invalidatableContent()` (iPhone widgets on a Mac run their intents on the phone).
- Budget: roughly 40–70 reloads a day (every 15–60 minutes) for a frequently viewed widget, with timeline entries at least about 5 minutes apart. Reloads while the app is in the foreground, intent runs and animations aren't charged, though foreground reloads can be throttled.
- Let the system tick: `Text(date, style: .timer)` or `.relative` and timer ranges need no reloads. Reload from the app with `WidgetCenter` when data changes; widget push updates (26) are budgeted too. When people look more often than you can update, show when the data was last updated. In 27, widgets update in real time while their app is open (unverified). Data changes animate by default, for 2 seconds at most (motion.md, MOT rules).
- Widget gallery: a realistic preview (simulated data if loading is slow), a placeholder of static shapes (`redacted`) rather than a spinner, and one description for all sizes that starts with a verb ("See the current weather…") in sentence case.

**Contexts**

- **StandBy** (iPhone charging in landscape) shows two small widgets side by side, scaled up, background removed, on black, and in monochrome red at night: use bigger text and little color. **CarPlay** (every car since 26) shows the same small widget in full color without its background, so supporting StandBy covers it; buttons work only on touchscreens.
- **Mac** (Tahoe): native and iPhone widgets sit on the desktop and in Notification Center, with the clear and tinted looks. **watchOS**: Smart Stack widgets default to black; a background color that carries meaning helps (Stocks: red falling, green rising), and relevance surfaces yours at the right moment (`RelevanceConfiguration`, watchOS 26).
- **visionOS 26**: widgets sit on walls and desks, elevated or recessed, with a paper or glass texture and a `simplified` level of detail at a distance (larger type, no buttons). A widget that doesn't suit a context (a photo widget on the Lock Screen) goes in `disfavoredLocations`.

## 3. Live Activities and the Dynamic Island

A Live Activity starts on iPhone or iPad. It appears on the Lock Screen, in the Dynamic Island and StandBy, as a banner on iPhones without the Island, in the Mac menu bar (Tahoe; a click opens iPhone Mirroring), in the Apple Watch Smart Stack and on the CarPlay Dashboard (26). Not on tvOS or visionOS.

| Presentation               | When the system uses it                                                                                        | Size (pt, 393- / 430-wide)                           | Design                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compact leading + trailing | One activity running                                                                                           | 52.33×36.67 / 62.33×36.67 each                       | One piece of information split around the camera: same color and type on both sides, snug to the camera with no padding toward it, balanced widths (abbreviate units). Both sides open the same screen. |
| Minimal                    | Several running: one attached, one detached (circle or oval); also StandBy                                     | 36.67–45 × 36.67                                     | Live data such as a countdown ring, not just a logo.                                                                                                                                                    |
| Expanded                   | Touch and hold, or an alerting update                                                                          | 371 / 408 wide, 84–160 high                          | The compact layout enlarged, elements in the same relative places, content wrapped close around the camera. Regions: leading, trailing, center, bottom.                                                 |
| Lock Screen                | The Lock Screen; the alert banner on iPhones without the Island; StandBy at 2× after a tap on the minimal view | 371 / 408 wide (iPad 425–500), 84–160 high           | Its own layout, not a copy of a notification. 14 pt margins; height grows and shrinks with the content. In StandBy the default background blends with the bezel; check Night Mode (red).                |
| Smart Stack, CarPlay       | Automatically, built from the compact pair                                                                     | Watch: widget sizes; CarPlay 240×78, 240×100, 170×78 | Add the `.small` family for a custom layout. CarPlay disables buttons.                                                                                                                                  |

**Look**

- The Island is always opaque black and its background can't be changed. Put bold brand colors on text and symbols, use a logo mark without a container (never the whole app icon), and set a matching `keylineTint` (the key line shows on dark backgrounds). Text is large and medium weight or heavier; `monospacedDigit()` keeps timers from jittering.
- Keep even margins, with nested corners concentric with the 44 pt Island corner (liquid-glass.md, GL rules; `ContainerRelativeShape`). Separate blocks with an inset shape or a thick line; never draw content to the Island's edge.
- On the Lock Screen the default background follows light and dark mode. A custom `activityBackgroundTint` must hold contrast in dark mode, on Always-On and in Night Mode, and people's wallpapers argue for restraint. Check the generated dismiss-button color (`activitySystemActionForegroundColor`).
- **27:** activities also appear in the Island in landscape, where compact views can't grow wider. Branch on `isDynamicIslandLimitedInWidth` to a narrower variant (an icon instead of a time string). For StandBy, draw Lock Screen–only gradients only when `showsWidgetContainerBackground` is true, and let `activityBackgroundTint` fill the screen.

**Lifecycle** (SYS-9, SYS-11)

- A defined start and end, active 8 hours at most; then the system ends it, and the Lock Screen keeps it up to 4 hours more. Start it when people expect one (an order placed, a followed match starting) and let them stop it in the app. A scheduled start (26) must alert; an App Shortcut can start one from the Action button.
- Update only when content changes. An alert lights the screen, plays the sound and shows the expanded view or a banner, so reserve it for updates people must not miss. Track several events in one rotating activity, not in several activities. Prefer a single button or toggle (a `LiveActivityIntent`), for pause and resume or a direct response. No ads; keep sensitive details behind a tap.
- End it immediately with final content and a proportional dismissal, typically 15–30 minutes (`.immediate`, `.after(_:)`, or the default of up to 4 hours). Show staleness once `staleDate` passes (`context.isStale`).
- Limits: static plus dynamic data 4 KB at most; images no larger than their presentation (minimal ≤ 45×36.67 pt), or the activity may fail to start; animations 2 seconds at most, and none on Always-On. Move existing elements to their new positions rather than removing and re-adding them.

## 4. Notifications

- **Content.** Title: short, title-style capitalization, no ending punctuation, and informative (a headline, event or subject). If the only title you have is generic, leave it out and the system shows your app name. Body: complete sentences in sentence case; let the system truncate. Never add your app name or icon, which the system already shows. Give generic text for hidden previews ("New comment"). A sound is optional, short, and never the only carrier of meaning.
- **Don't** send repeats for the same thing, tell people to go do something in the app, report errors (use an alert), or notify about what's already on screen (update the view or the badge).
- **Actions:** up to four, with short title-case labels that name the result, each with an SF Symbol. Prefer nondestructive actions, and never add one that only opens the app. On Apple Watch a double tap runs the first nondestructive action, so list the most-used first.
- **Grouping and badges:** give each conversation or order its own `threadIdentifier` so related notifications stack; `relevanceScore` picks the featured item in a summary. Badges count unread notifications only, never scores or dates; keep the count current, and never draw a badge of your own.
- **Interruption levels:** passive (read at leisure) · active (the default) · Time Sensitive (breaks through Focus and the scheduled summary; only for something happening now or within the hour; never marketing) · critical (health and safety; overrides the Ring/Silent switch; requires an entitlement).
- **Communication notifications** (calls and messages) show the sender's avatar and name instead of your icon, and delivery during a Focus depends on the sender. Adopt `INSendMessageIntent`.
- **Permission:** ask in context, after the first action that benefits (not at launch), or use provisional authorization, which delivers quietly to Notification Center with Keep and Turn Off buttons. Marketing needs explicit opt-in plus an in-app setting. Pre-permission screens: components.md (PAT-2, PAT-5).

## 5. Controls

A control is a button (it runs an action, opens a place in the app, or launches a locked-device camera capture) or a toggle (two states). People add controls to Control Center, the Lock Screen and the Action button (iOS/iPadOS 18), to Control Center and the menu bar on the Mac (macOS 26), and to Control Center, the Smart Stack and the Ultra Action button on Apple Watch (watchOS 26; the HIG page predates this). The best controls save a trip into the app, for example by starting a Live Activity.

- The symbol must work alone. The Lock Screen shows only the symbol; Control Center adds title and value at larger sizes; the Action button shows symbol and value in the Dynamic Island. Toggles need an on and an off symbol (`door.garage.open` and `door.garage.closed`). Animate state changes, and keep animating for as long as an action runs.
- The title names the thing (the lamp) and the value names its state. Give placeholder text when these vary, and an Action button hint that starts with a verb ("Hold for Silent").
- The tint color (your brand) colors the on-state symbol and the Action button readout. If a control needs setup (which light?), prompt for it when people add it (`promptsForUserConfiguration()`).
- Update on interaction, on completion, or by push. Redact the title and value on a locked device, and require authentication for doors, cars and other security actions.

## 6. Complications and the watch Smart Stack

- Build complications as WidgetKit accessory families (circular, corner, inline, rectangular); ClockKit is for legacy watchOS only. Support as many families as you can, and offer several complications, each deep-linking to its own place. Show dynamic, essential data. Tinted faces desaturate your complication and tint it from the face color, so don't encode meaning in color, and supply tinted image variants if desaturation fails. Lines are 2 pt or thicker. Default text is SF Rounded: circular 12–14.5 pt medium, corner 10–12 pt semibold, rectangular 16.5–19.5 pt medium, depending on case size.
- The Smart Stack uses the rectangular layout (152×69.5 pt on 40 mm up to 191×81.5 pt on 49 mm). Add a meaningful background color and relevance. Live Activities from iPhone land at the top of the stack automatically.

## 7. App Clips and App Shortcuts

- **App Clips** (iPhone and iPad): a fast, in-the-moment task or a demo, launched from an App Clip Code, NFC tag, QR code, Safari, Messages or Maps. Use native UI (no web views) and a linear flow with no tab bar or settings. Open straight on the relevant step, with no splash screen and no waiting. Don't require an account up front; offer Sign in with Apple and Apple Pay. Suggest the full app politely, after the task. Notifications serve only the task, for up to 8 hours unless people grant more. Use only App Clip Codes generated by Apple's tools.
- **App Shortcuts and Spotlight:** expose up to 10 key tasks as App Intents (`AppShortcutsProvider`) so they appear in Spotlight, Siri, Shortcuts and the Action button. Phrases are brief and include the app name. In common domains, consider app schemas instead (HIG, June 2026).

## 8. Common mistakes

1. `glassEffect`, `.ultraThinMaterial` or a frosted card inside a widget or Live Activity to "make it Liquid Glass". Delete it (SYS-1).
2. A background painted with `.background` or a ZStack color, which can't be removed and shows up in StandBy. Move it into `containerBackground(for: .widget)` (SYS-2).
3. A full-bleed photo with a text scrim that turns into a white slab in clear or tinted. Show it only in full color (SYS-3).
4. An app-like widget: six small buttons, a tab strip, a scrolling list (SYS-7).
5. A countdown kept current by reloading every minute instead of using timer text (SYS-8).
6. A compact Live Activity padded away from the camera, with unbalanced sides, or a static logo as the minimal view (SYS-10).
7. A push notification plus a Live Activity alert for the same update, Time Sensitive for a promotion, or an "Open App" action (SYS-11).

## 9. Implementation pointers

Names only unless shown in code; availability was checked on developer.apple.com symbol pages (September 2026). In-app SwiftUI lives in swiftui.md.

- **Widgets** (WidgetKit + SwiftUI): `StaticConfiguration` / `AppIntentConfiguration`, `supportedFamilies(_:)`, `containerBackground(_:for:)` with `.widget`, `containerBackgroundRemovable(_:)`, `contentMarginsDisabled()` + `widgetContentMargins`, `widgetRenderingMode`, `widgetAccentable(_:)`, `Image.widgetAccentedRenderingMode(_:)`, `showsWidgetContainerBackground`, `AccessoryWidgetBackground`, `widgetURL(_:)` / `Link`, `Button(_:intent:)` / `Toggle(isOn:intent:label:)`, `invalidatableContent(_:)`, `privacySensitive(_:)`, `isLuminanceReduced`, `disfavoredLocations(_:for:)`, `WidgetCenter.shared.reloadTimelines(ofKind:)`, `WidgetPushHandler` (26), `RelevanceConfiguration` (watchOS 26), `supportedMountingStyles(_:)` / `widgetTexture(_:)` / `levelOfDetail` (visionOS 26), `.systemExtraLargePortrait` (27 on iOS, iPadOS, macOS).
- **Live Activities** (ActivityKit + WidgetKit): `ActivityAttributes` with `ContentState`, `Activity.request(attributes:content:pushType:)`, `update(_:alertConfiguration:)`, `end(_:dismissalPolicy:)`, `ActivityContent(state:staleDate:relevanceScore:)`, `ActivityConfiguration(for:content:dynamicIsland:)`, `DynamicIsland(expanded:compactLeading:compactTrailing:minimal:)`, `DynamicIslandExpandedRegion(.leading/.trailing/.center/.bottom)`, `keylineTint(_:)`, `contentMargins(_:_:for:)`, `activityBackgroundTint(_:)`, `activitySystemActionForegroundColor(_:)`, `supplementalActivityFamilies([.small, .medium])` + `activityFamily`, `isDynamicIslandLimitedInWidth` (27), `LiveActivityIntent`.
- **Controls:** `ControlWidget`, `StaticControlConfiguration` / `AppIntentControlConfiguration`, `ControlWidgetButton` / `ControlWidgetToggle`, `ControlValueProvider`, `SetValueIntent`, `controlWidgetActionHint(_:)`, `promptsForUserConfiguration()`, `ControlCenter.shared.reloadControls(ofKind:)`, `IntentAuthenticationPolicy`. **Notifications:** `UNNotificationInterruptionLevel`, `threadIdentifier`, `relevanceScore`, `UNNotificationActionIcon`, `hiddenPreviewsBodyPlaceholder`, `UNAuthorizationOptions.provisional`, `INSendMessageIntent`.

Typechecked with Xcode 26.3 (iOS 26.2 SDK, iOS 18 and 26 targets); the entry, provider, intent, widget configuration and Lock Screen view are omitted.

```swift
// Widget view: removable background, accent group, photo only in full color, live time, deep link.
struct OrderWidgetView: View {
    @Environment(\.widgetRenderingMode) private var mode
    let entry: OrderEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if mode == .fullColor { Image(entry.coverImageName).resizable().scaledToFit() } // photos stay photos
            else { Image(systemName: "takeoutbag.and.cup.and.straw.fill").font(.title2) }    // symbols tint cleanly
            Text(entry.title).font(.headline)
            Text(entry.eta, style: .relative).font(.title2.bold()).widgetAccentable() // ticks without reloads
            Button("Picked Up", systemImage: "checkmark", intent: MarkPickedUpIntent())
        }
        .containerBackground(Color.orange.gradient, for: .widget) // removable; system swaps in glass or tint
        .widgetURL(entry.url)                                     // opens this order, not the app's root
    }
}
// Live Activity: every presentation, snug compact pair, live minimal view, key line, watch/CarPlay layout.
struct DeliveryAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable { var status: String; var start: Date; var eta: Date }
    var orderID: String
}
struct DeliveryActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DeliveryAttributes.self) { context in
            DeliveryLockScreenView(context: context)                  // Lock Screen, banner, StandBy
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "bag.fill") }
                DynamicIslandExpandedRegion(.trailing) { Text(context.state.eta, style: .timer) }
                DynamicIslandExpandedRegion(.bottom) { Text(context.state.status).font(.headline) }
            } compactLeading: {
                Image(systemName: "bag.fill").foregroundStyle(.orange)
            } compactTrailing: {
                Text(context.state.eta, style: .timer).monospacedDigit().frame(maxWidth: 44)
            } minimal: {                                              // live data, not just a logo
                ProgressView(timerInterval: context.state.start...context.state.eta).progressViewStyle(.circular)
            }
            .keylineTint(.orange)
            .widgetURL(URL(string: "myapp://order/\(context.attributes.orderID)"))
        }
        .supplementalActivityFamilies([.small])  // then branch on activityFamily for Smart Stack / CarPlay
    }
}
```

## 10. Sources

- HIG (the widgets and Live Activities pages were revised Dec 16, 2025; App Shortcuts June 8, 2026): https://developer.apple.com/design/human-interface-guidelines/widgets · …/live-activities · …/notifications · …/managing-notifications · …/controls · …/complications · …/app-clips · …/always-on · …/app-shortcuts
- WidgetKit articles, under https://developer.apple.com/documentation/widgetkit/ : optimizing-your-widget-for-accented-rendering-mode-and-liquid-glass · displaying-the-right-widget-background · preparing-widgets-for-additional-contexts-and-appearances · keeping-a-widget-up-to-date · adding-interactivity-to-widgets-and-live-activities · linking-to-specific-app-scenes-from-your-widget-or-live-activity · animating-data-updates-in-widgets-and-live-activities · adding-standby-and-carplay-support-to-your-widget · creating-controls-to-perform-actions-across-the-system
- ActivityKit: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities · …/creating-custom-views-for-live-activities · WidgetKit and ActivityKit updates: https://developer.apple.com/documentation/updates/widgetkit · Asking permission to use notifications: https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications · Symbol pages checked for availability: `WidgetFamily.systemExtraLargePortrait`, `isDynamicIslandLimitedInWidth`, `ControlWidget`, `WidgetPushHandler`, `UNNotificationInterruptionLevel`
- WWDC25 "What's new in widgets" https://developer.apple.com/videos/play/wwdc2025/278/ · WWDC26 "WidgetKit foundations" https://developer.apple.com/videos/play/wwdc2026/277/ · WWDC26 "Live Activities essentials" https://developer.apple.com/videos/play/wwdc2026/223/
- Secondary, for 27 behavior not yet on HIG pages: MacStories, iOS and iPadOS 27 review (extra-large widgets on iPhone) https://www.macstories.net/stories/ios-and-ipados-27-review/3/ · TidBITS, Apple's WWDC26 feature list https://tidbits.com/2026/06/11/all-264-items-on-apples-wwdc26-sweating-the-details-slide/
