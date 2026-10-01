# Interaction feedback: how controls answer input (OS 26 / 27)

This file owns **how controls respond to input**: the state model (pressed, hover, focused, selected, mixed, disabled, busy), per-control Liquid Glass feedback, haptics, sound, the pointer, gaze and focus engines, outcome feedback (success, error, destructive, loading, undo), feedback accessibility, hit-region measurement, and native and web recipes. **How things move** (springs, curves, transitions, gesture physics, the Reduce Motion policy MOT-5) lives in [motion.md](motion.md): this file says _when_ and _what_ responds and links to the relevant motion.md section. Values owned by other files are cited by rule ID, never restated: hit targets and spacing HIT-1/HIT-2, contrast CON-1/CON-2, on-color labels COL-3, safe areas LAY-1 and text styles TYP-1 (foundations.md); the functional glass layer, grouping and variants GL-1/GL-2/GL-4 (liquid-glass.md); prominence, button material and sheets CMP-2/CMP-3/CMP-5 (components.md).

Markers: _(unverified)_ means not confirmed in an Apple primary source and is the only uncertainty marker; _(observed)_ means shipping system behavior that Apple doesn't document. Everything else was checked against the HIG, Apple API docs, the 26.2 SDK interfaces, WebKit or WWDC sessions, and control metrics were measured on the iOS 26.3 runtime (§13). **27** marks OS 27 changes.

## Rules at a glance

| ID    | Rule                                                                                                                                                                                                                                       | Why                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| FB-1  | Show the pressed state on touch-down or mouse-down and act on release inside the control; dragging off past a margin cancels, dragging back re-arms.                                                                                       | Any latency reads as broken; acting on release lets people change their mind.                                          |
| FB-2  | Hover effects only on hover-capable pointers (iPadOS and macOS pointers, visionOS gaze), and nothing essential hides behind hover.                                                                                                         | Touch has no hover: hover-only affordances are invisible there, and hover styles stick after a tap.                    |
| FB-3  | Every custom control implements pressed, focused, selected and disabled states through the shared state tokens. Disabled means dimmed, inert and explained, never hidden; never disable tabs.                                              | Missing states make controls feel dead or ambiguous; unexplained or vanishing controls look like bugs.                 |
| FB-4  | Haptics: one per meaningful outcome, with the semantic type that matches it; none on top of system controls that already play one; never the only channel.                                                                                 | Consistency teaches meaning; overuse numbs; duplicates double-fire; single-channel feedback excludes people.           |
| FB-5  | Outcome feedback: confirm success in place (the result itself, or a symbol effect with an optional success haptic) in proportion to its significance; show errors inline with a specific fix; no toasts by default. Undo vs confirm: FB-9. | People expect success and need to know when and why something failed; toasts get missed and time out.                  |
| FB-6  | Focus is always visible and platform-shaped: an accent focus ring on the web and macOS, a highlight on focused list rows, lift on tvOS, the gaze highlight on visionOS.                                                                    | Keyboard, remote, Switch Control and gaze users navigate by focus.                                                     |
| FB-7  | Loading feedback takes the control's place: an indicator inside it, a progressive label, no repeat submission; delay spinners so fast results never flash; show determinate progress when the amount is known.                             | Keeps context, prevents double actions and avoids jitter.                                                              |
| FB-8  | Use standard controls first, and never layer a second press effect, haptic or sound over one the system already plays.                                                                                                                     | System controls already combine state, glass, haptics, sound and accessibility; duplicates feel wrong and double-fire. |
| FB-9  | Prefer undo to confirmation; confirm only uncommon, unexpected or irreversible loss, with a dialog anchored to its source and Cancel as the safe path.                                                                                     | Confirmations shown every time get dismissed on autopilot.                                                             |
| FB-10 | Every visual state has an accessible equivalent (value, trait, announcement); Reduce Motion keeps the state change and drops the flourish (MOT-5).                                                                                         | State must survive VoiceOver, Switch Control and motion sensitivity.                                                   |
| FB-11 | Measure the tappable box, not the visual: including padding and `contentShape` or pseudo-element extensions, it must meet HIT-1.                                                                                                           | Undersized targets are the most common failed interaction, and eyeballing misses them.                                 |
| FB-12 | Interactive glass only on controls or containers of controls in the functional layer (GL-1), preferably through system glass buttons.                                                                                                      | Glass that reacts where nothing can happen is a false affordance.                                                      |

## Contents

1. Principles · 2. State model · 3. Touch timing · 4. Liquid Glass control feedback · 5. Haptics · 6. Sound · 7. Pointer, keyboard, gaze, remote, Crown
2. Outcome feedback · 9. Accessibility and hit regions · 10. Native recipes (10.1 Button style with honest states · 10.2 Busy, then success or error, in place · 10.3 Repeating stepper with haptics · 10.4 Floating glass and toggle buttons · 10.5 Inline validation and focus · 10.6 UIKit: in-button activity, haptics, scroll highlight · 10.7 visionOS control feedback)
3. Web recipes · 12. Anti-patterns · 13. Sources and verification

## 1. Principles

- **Answer immediately.** Highlight on touch-down, confirm on touch-up: people are "really, really sensitive" to latency (WWDC18 _Designing Fluid Interfaces_). The HIG requires a press state on custom buttons, because without one a button "can feel unresponsive", and WWDC26 _Make your game great with touch_ asks the same of every touch control. The one sanctioned delay is inside scroll views (§3).
- **Proportional.** Status sits quietly in place (Mail shows update status and unread count in its toolbar). Interrupt only for possible data loss or a critical, actionable problem (HIG Feedback). Match a haptic's intensity and sharpness to the animation it accompanies (HIG Playing haptics).
- **Revocable, then forgiving.** An input can be taken back until release (slide off to cancel). After release, offer undo rather than "Are you sure?" (§8). WWDC26 _Principles of great design_ calls this forgiveness, and it supports agency.
- **Continuous.** During a drag, press or Crown turn, feedback tracks the input every frame: the Flashlight button grows with pressure, and the tvOS focus engine shows direction before focus moves. Don't drive direct manipulation from recognizers that report only at the end, such as `UISwipeGestureRecognizer`.
- **Layered.** Visual state (always) → motion (motion.md) → haptic (iPhone, Apple Watch, Mac trackpad, Apple Pencil Pro) → sound (primary on visionOS, rare on iOS) → assistive announcement. Lower layers repeat the visual one and never carry meaning alone, so feedback still reaches people who silence the device, look away or use VoiceOver (HIG Feedback).
- **Confirm outcomes, not just inputs.** The pressed state says "received"; the outcome says "done", "failed, here's why", or offers undo (§8). People expect success, so reserve explicit confirmation for significant tasks such as Apple Pay, and always explain failures (HIG Feedback).
- **Causality, harmony, utility** (WWDC19 _Designing Audio-Haptic Experiences_). The cause must be obvious; sight, sound and touch must agree in timing and character; and a channel is added only where it adds value, which often means adding neither.

## 2. State model

**FB-3** Standard controls implement every row below. A custom control implements each row that applies, and at least pressed, focused, selected and disabled, on every platform it ships to: natively with one pressed treatment per style (`ButtonStyle`, `configurationUpdateHandler`), on the web with the shared state tokens (`--press-*`, `--hover-*`, `--focus-*`, `--state-*`; §11). Disabled stays visible, dimmed and inert, and nearby text says what unlocks it. Never disable or hide tabs; explain an empty state inside the tab instead. Row sources: HIG Buttons (visionOS idle, hover, selected and unavailable states; press states; activity indicators in iOS buttons), Focus and selection (tvOS's five states, iPadOS/macOS row highlight), Toggles (checkbox mixed state, toggle buttons), Menus and Context menus (dim vs hide), Tab bars (never disable), Feedback and Loading (watchOS).

| State             | iOS / iPadOS                                                                                                                                                    | macOS                                                                         | visionOS                                                                          | tvOS                                                        | watchOS                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| **Normal**        | Resting look; transient glass (knobs, thumbs) stays in the content layer until touched                                                                          | Resting bezel, or borderless                                                  | Idle: visible background shape (thin material on a window, glass when floating)   | Unfocused: flat, less prominent                             | Resting; inline buttons are capsules                           |
| **Pressed**       | Immediate. Glass scales, bounces and glows from the touch point; filled styles darken and rows get a gray highlight _(observed)_                                | Bezel darkens _(observed)_. **27**: interactive glass bounces subtly on click | The system control sound plays; the visual depends on the control _(observed)_    | Highlighted: the focused item animates briefly when clicked | System highlight                                               |
| **Hover**         | iPadOS pointer: highlight, lift or hover effect (§7)                                                                                                            | Quiet: toolbar items reveal their appearance; tooltip after a pause           | The system highlights what people look at (out of process); tooltip after a dwell | None; focus replaces it                                     | None                                                           |
| **Focused**       | Hardware keyboard on iPad: halo ring on fields and custom views; accent highlight with white text on list rows                                                  | Accent focus ring on fields; accent highlight on rows of a focused list       | Focus effects for keyboard or controller, separate from gaze hover                | Lift: larger, elevated, lit; parallax on cards              | Crown input goes to the `focusable()` view                     |
| **Selected / on** | A changed background on toggle buttons (not color alone); switch track; glass selection in tab bars and segmented controls; checkmark in option lists and menus | Checkbox checkmark, radio dot, selected segment                               | White fill with a dark glyph is reserved for the toggled state                    | Distinct selected state, separate from focus                | Filled symbol or tint                                          |
| **Mixed**         | No native control; put "Mixed" in the value text                                                                                                                | Checkbox dash                                                                 | None                                                                              | None                                                        | None                                                           |
| **Disabled**      | Dimmed, inert, still visible, with the reason nearby                                                                                                            | Dimmed; menu items dim; context-menu items hide                               | Unavailable style                                                                 | Unavailable: no shadow, low contrast, can't take focus      | Dimmed                                                         |
| **Busy**          | Indicator in the button plus a progressive label ("Checking Out…")                                                                                              | Small spinner beside or in the control                                        | As iOS                                                                            | As iOS                                                      | Avoid indeterminate indicators; promise a notification instead |

| State    | SwiftUI                                                                        | UIKit                                                             | Web (§11)                                                       |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Pressed  | `ButtonStyle.Configuration.isPressed`                                          | `isHighlighted`, `configurationUpdateHandler`                     | `:active`, `[data-pressed]`                                     |
| Hover    | `.hoverEffect`, `onHover`, `onContinuousHover`                                 | `UIView.hoverStyle`, `UIPointerInteraction`, `UIButton.isHovered` | `:hover` inside `(hover: hover) and (pointer: fine)`            |
| Focused  | `@FocusState`, `.focused`, `.focusable(interactions:)`, `.focusEffectDisabled` | `isFocused`, `UIFocusHaloEffect`                                  | `:focus-visible`                                                |
| Selected | `Toggle`, `.accessibilityAddTraits(.isSelected)`                               | `isSelected`, `changesSelectionAsPrimaryAction`                   | `aria-pressed`, `aria-checked`, `aria-selected`, `aria-current` |
| Mixed    | `Toggle(_:sources:isOn:)`                                                      | None                                                              | `aria-checked="mixed"`, `input.indeterminate`                   |
| Disabled | `.disabled`, `@Environment(\.isEnabled)`                                       | `isEnabled`                                                       | `disabled`, `aria-disabled="true"`                              |
| Busy     | `ProgressView` in the label, plus `.disabled`                                  | `Configuration.showsActivityIndicator`                            | `aria-busy="true"` with `aria-disabled="true"`                  |

## 3. Touch timing

- **Down, move, up.** **FB-1** Highlight on touch-down and act on touch-up inside. Moving outside the control plus a comfortable margin clears the highlight and makes release cancel; moving back re-highlights (_Designing Fluid Interfaces_). UIKit events map one to one: `.touchDown`, `.touchDragExit` / `.touchDragEnter`, `.touchUpInside` (buttons send `.primaryActionTriggered`), `.touchUpOutside`, `.touchCancel`. The size of UIKit's tracking margin isn't documented.
- **Scroll vs tap.** `UIScrollView.delaysContentTouches` (default `true`) holds touch-down briefly until the scroll view knows whether the finger is scrolling, so rows and buttons in scroll views highlight a beat later. Once scrolling starts, tracking cancels (`canCancelContentTouches`, default `true`). By default `touchesShouldCancel(in:)` returns `true` for everything except `UIControl`s, so to get an instant highlight _and_ still scroll from a button, set `delaysContentTouches = false` and override it to return `true`. SwiftUI buttons in `ScrollView` and `List` show the same delay _(observed)_.
- **Drag start.** A touch becomes a drag after about 10 pt of movement (hysteresis). From then on content moves 1:1 with the finger and keeps the grab offset (_Designing Fluid Interfaces_). Drag and drop shows its drag image after about 3 pt (HIG). **27**: `UIDragInteraction.liftBehavior = .extended` lengthens the lift delay in gesture-rich canvases, and `allowsPointerDragBeforeLiftDelay` defaults to `true` on iOS and `false` on macOS.
- **Long press.** The default is a 0.5 s minimum within 10 pt of movement (`LongPressGesture`, `onLongPressGesture`, `UILongPressGestureRecognizer`). Give feedback while the finger is held (`onPressingChanged`) so people learn that holding does something.
- **Context menus.** Use the system interaction (`contextMenu`, `UIContextMenuInteraction`). The preview emerges from the content and the screen behind dims (HIG); timing and haptic belong to the system (haptic _(observed)_). Never build one on a custom long-press timer.
- **Double tap costs latency.** A double-tap recognizer delays single taps on the same view by about half a second (_Designing Fluid Interfaces_). Use it only where that delay is acceptable, such as zooming a photo.
- **Detect in parallel.** Start all candidate gestures together and cancel the losers as soon as intent is clear, instead of waiting to decide (_Designing Fluid Interfaces_). **27**: `GestureInputKinds` (`.directTouch`, `.indirectTouch`, `.pencil`, `.pointer`) limits a gesture to certain inputs. Treat pointer and finger differently only when it adds value (HIG).
- **Other inputs.** visionOS: people look, then pinch (indirect) or touch directly, and the element highlights before the pinch. tvOS: a press (click) is intentional, but a tap on the touch surface may be accidental, so don't act on taps during playback (HIG Remotes). watchOS: double tap highlights the view's `handGestureShortcut(.primaryAction)` control, then performs it; don't set one in scrolling views (HIG Gestures).

## 4. Liquid Glass control feedback (26 → 27)

Liquid Glass is itself the feedback surface. It "responds to interaction by instantly flexing and energizing with light", illuminating from within "starting right under your fingertips", and the glow "spreads throughout the element and onto any Liquid Glass elements nearby". Controls "lift up into Liquid Glass temporarily" while touched, so the resting state stays quiet and the lens shows the value underneath (WWDC25 _Meet Liquid Glass_). Direct touch gets a stronger response than a trackpad (HIG Motion); Reduce Motion lowers the intensity and turns off the elastic behavior. Timing and springs: `motion.md` §6 (Liquid Glass motion). **FB-8** All of this comes with the system controls, so use them first and never add a second press effect, haptic or sound on top of theirs. **FB-12** Custom glass reacts only when marked interactive; do that only on controls or containers of controls in the functional layer (GL-1), preferably through the system glass button styles, and group neighbours in one container (GL-2) so light spreads between them.

| Control                                                                            | System behavior (26)                                                                                                                                                                                                     | 27                                                                                                                    | Your job                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Custom glass: `glassEffect(.regular.interactive())`, `UIGlassEffect.isInteractive` | Scales, bounces and shimmers on touch, like toolbar buttons and sliders (WWDC25 323, 284)                                                                                                                                | macOS: interactive glass bounces subtly on click (`NSGlassEffectView.effectIsInteractive`; SwiftUI interactive glass) | Only on controls or containers of controls (FB-12). `Glass` is unavailable on visionOS.                                                                                                                                                                      |
| Glass buttons: `.glass`, `.glassProminent`, `UIButton.Configuration.glass()`       | Scale and bounce on tap; pointer effects                                                                                                                                                                                 | —                                                                                                                     | Prefer these to custom glass and add no extra scale or glow. Glass styles belong to the functional layer or float over media; in-content buttons are bordered or filled (CMP-3). On iOS, `.extraLarge` renders like `.large`.                                |
| Toolbar and navigation-bar items                                                   | Grouped on glass; the system draws hover and selection appearances                                                                                                                                                       | Navigation bars can slide away on scroll                                                                              | Use borderless symbols and no custom pressed backgrounds.                                                                                                                                                                                                    |
| Menus, popovers, alerts, dialogs, sheets                                           | Morph out of the glass control that opened them; glass behaves as thicker glass as it grows                                                                                                                              | —                                                                                                                     | Anchor to the source. Menus do it automatically, popovers when the source is a bar-button item, sheets through the zoom transition, and `confirmationDialog` when it's attached to the button. Inline action sheets have no Cancel; tapping outside cancels. |
| Switch (`Toggle`)                                                                  | Capsule track with a pill-shaped knob (iOS 26: track 63×28 pt, knob 37×24 pt). The knob lifts into a glass lens while touched or dragged, showing the track through it; plays a haptic                                   | —                                                                                                                     | Switch style only in list rows; outside a list use a toggle-style button (`.toggleStyle(.button)`). A custom switch copies this geometry and extends its hit region (FB-11).                                                                                 |
| Slider                                                                             | The thumb turns to glass while dragged and "preserves momentum and stretches". Tick marks appear with `step`; `neutralValue` anchors the fill; UIKit adds a `.thumbless` style for playback; plays haptics               | —                                                                                                                     | Use `neutralValue` for ranges with a midpoint and `allowsTickValuesOnly` (UIKit, default `true`) for discrete values. For volume, use the system volume view, not a slider.                                                                                  |
| Segmented control                                                                  | 31–32 pt tall (SwiftUI 31, UIKit 32). The selection thumb takes on glass while you interact and can be dragged between segments _(observed)_                                                                             | —                                                                                                                     | Extend the hit region to HIT-1 (FB-11). Don't mix actions and selection. tvOS selects a segment when it gains focus.                                                                                                                                         |
| Stepper                                                                            | Press and hold auto-repeats (`UIStepper.autorepeat`, default `true`)                                                                                                                                                     | `UIStepper` fully supported in the Mac idiom                                                                          | Give custom +/− buttons `.buttonRepeatBehavior(.enabled)`. On macOS, consider Shift-click for bigger steps (HIG).                                                                                                                                            |
| Picker, date wheels                                                                | Selection haptic as values pass                                                                                                                                                                                          | —                                                                                                                     | Add nothing.                                                                                                                                                                                                                                                 |
| Tab bar                                                                            | A glass selection sits under the selected tab; press-and-slide moves it across tabs and release selects _(observed)_                                                                                                     | `Tab(role: .prominent)`                                                                                               | Never disable or hide tabs (FB-3). Tabs navigate; they never run actions.                                                                                                                                                                                    |
| Context menu                                                                       | The preview lifts from its content and the background dims                                                                                                                                                               | Uses the glass material _(unverified)_                                                                                | Hide unavailable items; put destructive items last.                                                                                                                                                                                                          |
| List rows                                                                          | Highlight on touch, after the scroll delay; navigation lists keep the selected row highlighted in split views; option lists flash, then show a checkmark. iOS 26 rows are ≈53 pt (CMP-7), so the whole row is the target | —                                                                                                                     | Use `List` and `NavigationLink`, not tap gestures on stacks. Highlight rows with a fill; never scale them.                                                                                                                                                   |
| Swipe actions                                                                      | A full swipe performs the first action (`allowsFullSwipe`, default `true`); haptic at the full-swipe point _(observed)_                                                                                                  | `swipeActions(…onPresentationChanged:)`, and `swipeActionsContainer()` for any container                              | Allow a full-swipe delete only when it's undoable (FB-9).                                                                                                                                                                                                    |
| Reorder, drag                                                                      | The item lifts and a placeholder keeps its slot (WWDC26 271)                                                                                                                                                             | `reorderable()` with `reorderContainer(for:isEnabled:move:)`, also on watchOS                                         | Highlight a drop target only while it can accept; a failed drop flies back or evaporates (HIG).                                                                                                                                                              |
| Pull to refresh                                                                    | `refreshable` shows the indicator for the whole refresh; haptic when armed _(observed)_                                                                                                                                  | `NSRefreshController` on the Mac; `UIRefreshControl` in the Mac idiom                                                 | It supplements automatic refresh. Add a title only if it's informative.                                                                                                                                                                                      |
| Text and search fields                                                             | Focus brings the caret and keyboard, plus a focus ring with a hardware keyboard on iPad and Mac. A search field in its own tab focuses immediately, except on iPad with only the software keyboard                       | —                                                                                                                     | Validate per field type (§8).                                                                                                                                                                                                                                |
| Sheets                                                                             | Dragged up, the glass recedes, turns more opaque and grows slightly (WWDC25 356)                                                                                                                                         | —                                                                                                                     | Detents and materials: CMP-5. A swipe-to-dismiss with unsaved changes gets an action sheet (FB-9).                                                                                                                                                           |
| Windows (iPad, Mac)                                                                | An inactive window's glass recedes                                                                                                                                                                                       | iPadOS icons and text: liquid-glass.md §1                                                                             | Dim custom chrome with `appearsActive`.                                                                                                                                                                                                                      |

## 5. Haptics

**FB-4** One haptic per meaningful outcome, with the type whose documented meaning matches (table below); never on every tap, never the only signal, and none on top of a system control that already plays one. The system already plays haptics for switches, sliders and pickers on iPhone, and for Digital Crown and list detents on Watch (HIG); also _(observed)_ for context-menu presentation, a swipe action's full swipe, arming pull-to-refresh, and drag lift.

**Where haptics exist.** On iPhone and Apple Watch (the Taptic Engine; Watch pairs its built-in haptics with a tone), Mac Force Touch trackpads, Apple Pencil Pro and some trackpads on supported iPads, and game controllers. The iPad itself and Apple Vision Pro have none (Core Haptics docs), and on Apple TV only game controllers do (HIG).

| Meaning                                              | SwiftUI `SensoryFeedback`                                                                                             | UIKit                                                                                            | watchOS `WKHapticType`                        | macOS          | SwiftUI plays on  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------- | ----------------- |
| Task succeeded                                       | `.success`                                                                                                            | `UINotificationFeedbackGenerator`, `.success`                                                    | `.success`                                    | —              | iOS, watchOS      |
| Warning                                              | `.warning`                                                                                                            | notification, `.warning`                                                                         | —                                             | —              | iOS, watchOS      |
| Failed, wrong input                                  | `.error`                                                                                                              | notification, `.error`                                                                           | `.failure` (`.retry` if the person can retry) | —              | iOS, watchOS      |
| Stepping through discrete values                     | `.selection`                                                                                                          | `UISelectionFeedbackGenerator`                                                                   | `.click`                                      | —              | iOS, watchOS      |
| Collision, snap into place                           | `.impact`, `.impact(weight:intensity:)`, `.impact(flexibility:intensity:)`                                            | `UIImpactFeedbackGenerator` (`.light/.medium/.heavy/.soft/.rigid`), `impactOccurred(intensity:)` | —                                             | `.generic`     | iOS, watchOS      |
| Aligned to a guide                                   | `.alignment`                                                                                                          | `UICanvasFeedbackGenerator.alignmentOccurred(at:)`                                               | —                                             | `.alignment`   | iOS, macOS        |
| Drawn path completed or recognized                   | `.pathComplete`                                                                                                       | `UICanvasFeedbackGenerator.pathCompleted(at:)`                                                   | —                                             | —              | iOS               |
| Important value crossed a threshold                  | `.increase`, `.decrease`                                                                                              | —                                                                                                | `.directionUp`, `.directionDown`              | —              | watchOS, visionOS |
| Activity started, stopped                            | `.start`, `.stop`                                                                                                     | —                                                                                                | `.start`, `.stop`                             | —              | watchOS           |
| Pressure level changed                               | `.levelChange`                                                                                                        | —                                                                                                | —                                             | `.levelChange` | macOS             |
| Custom control pressed, released, value changed (26) | `.press(.button/.buttonIconOnly/.slider/.toggle/.tab)`, `.release(.slider)`, `.selection(.on/.off/.minimum/.maximum)` | —                                                                                                | —                                             | —              | visionOS only     |

Weights are `.light`, `.medium` and `.heavy`; flexibilities are `.rigid`, `.solid` and `.soft`; intensity defaults to 1.0, and not every platform distinguishes them (Apple docs). The macOS column is `NSHapticFeedbackManager` patterns.

- **`sensoryFeedback` fires when `trigger` changes.** The `condition:` variant filters on `(old, new)`, and the closure variant returns a feedback or `nil`. Setting a Bool to `true` twice is not a change, so drive outcomes with a counter or a result value.
- **The system decides.** Feedback plays only on capable hardware, in the foreground, with the system Haptics setting on. Don't check the device type; just report the event (Apple, _Playing haptic feedback in your app_). Depending on platform and settings, the result may be haptics, audio, both or neither (WWDC24 10214).
- **UIKit generators.** Create one with `init(view:)` or `init(style:view:)` (iOS 17.5; plain `init()` is slated for deprecation) on a view near the feedback, and keep a reference. Call `prepare()` a moment before the likely event, such as when a drag begins: calling it immediately before triggering doesn't reduce latency, and the prepared state lasts only seconds. Pass the location (`impactOccurred(intensity:at:)`, `notificationOccurred(_:at:)`, `selectionChanged(at:)`) so the system has context, for example to play the haptic on Apple Pencil Pro.
- **watchOS**: use `sensoryFeedback` or `WKInterfaceDevice.current().play(_:)`. Crown detents are on by default (`digitalCrownRotation(…isHapticFeedbackEnabled:)`); turn them off when they fight your animation (HIG).
- **macOS**: `NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .drawCompleted)`, and only in response to the user's own action (AppKit docs).
- **Core Haptics** is for custom patterns in games and signature moments: transient and continuous events with intensity and sharpness, AHAP files, and synchronized audio. Check `CHHapticEngine.capabilitiesForHardware().supportsHaptics`, and offer an in-app off switch (HIG: make haptics optional). Whether the system Haptics switch also silences Core Haptics is _(unverified)_.
- **visionOS** has no haptics, and standard controls play sounds instead. On visionOS 26 and later, a custom control can request the system's control feedback with `.press(…)`, `.release(…)` and `.selection(…)`.
- **Don't**: play a haptic for every tap, navigation, scroll or keystroke; choose a pattern "because of the way it feels" (Apple docs); fire for events the person didn't cause; run long continuous haptics in an app; or vibrate while the camera, microphone or gyroscope is in use (HIG).

## 6. Sound

- **iOS apps can't use the system's UI sound effects or alert sounds** (AudioToolbox docs). The one system UI sound an app can trigger is the keyboard click in a custom input view: adopt `UIInputViewAudioFeedback`, return `true` from `enableInputClicksWhenVisible`, and call `UIDevice.current.playInputClick()`. It plays only if the person turned keyboard clicks on.
- **Custom UI sounds** should be rare, short, and paired with haptic and visual feedback. Play them in the `.ambient` audio session category, which mixes with other audio and is silenced by the Silent switch and screen lock; people expect silent mode to silence nonessential sounds (HIG Playing audio). `AudioServicesPlaySystemSound` plays a short sound immediately, at system volume, one at a time.
- **visionOS runs on sound.** Standard buttons play it, custom elements need their own spatialized sounds, and a repeated sound should vary slightly in pitch and volume (HIG).
- **macOS**: use `NSSound.beep()` for a refused action. `AudioServicesPlayAlertSound(kSystemSoundID_UserPreferredAlert)` plays the user's alert sound, or flashes the screen if they chose that.
- **tvOS** plays no system sounds for alerts or notifications. **watchOS** pairs its built-in haptics with a tone. Everywhere, sound never carries meaning alone; pair it with visuals and haptics (HIG Accessibility).

## 7. Pointer, keyboard, gaze, remote, Crown

**FB-2** Hover responds only where something can hover: the iPadOS and macOS pointer and visionOS gaze. On the web, gate hover styles with `(hover: hover) and (pointer: fine)`, and never hide an essential action behind hover. **iPadOS pointer** (HIG Pointing devices):

| Effect    | Use for                                      | System default and look                                                                                                              | SwiftUI / UIKit                                                        |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Highlight | Small elements with a transparent background | Bar buttons, tab bars, segmented controls, edit menus. The pointer becomes a platter behind the element, with parallax and magnetism | `.hoverEffect(.highlight)`; `UIHoverStyle(effect: .highlight, shape:)` |
| Lift      | Small elements with an opaque background     | App icons, Control Center buttons. The element scales up with a shadow and highlight; magnetism                                      | `.hoverEffect(.lift)`                                                  |
| Hover     | Large elements                               | Custom scale, tint and shadow. The pointer keeps its shape; no magnetism                                                             | A custom hover effect; `UIPointerHoverEffect`                          |

Pad pointer hit regions per HIT-2 (more around borderless elements than bezeled ones), make bar-button hit regions contiguous, and give lift a matching corner radius (`.contentShape(.hoverEffect, …)`). Don't scale list rows or add a shadow without scale. Let the pointer reveal controls that auto-hide.

- **macOS.** Hover is quiet. Toolbar items show hover and selection appearances automatically, and tooltips (`.help(_:)`) appear after a pause. The cursor explains what a drag will do: open or closed hand, copy, not allowed (`pointerStyle(_:)`). The default button responds to Return and is drawn as the default (`.keyboardShortcut(.defaultAction)`); Escape cancels (`.cancelAction`). Never make a destructive button the default. When keyboard navigation is turned on in System Settings, Tab and Shift-Tab move focus and an accent focus ring shows it.
- **visionOS gaze.** The system highlights whatever people look at, outside your app's process, so your app never learns where someone looked until they act (a privacy guarantee). Standard controls get the highlight automatically. For custom views, add `.hoverEffect()`, or a `CustomHoverEffect` with a `HoverEffectGroup`, and one `contentShape(.hoverEffect, …)` that covers a composite component. For RealityKit entities, add `HoverEffectComponent`, `InputTargetComponent` and `CollisionComponent`. Choose a custom effect's delay by purpose: none for subtle affordances, short for expansions, longer for tooltips. Keep one view unchanged in both states. System buttons don't support custom hover effects. Size targets per HIT-1 (visionOS values) and use rounded shapes.
- **tvOS focus.** Focus stands in for the pointer. Design all five states (§2), ship assets at the enlarged focused size, and leave room so neighbors don't crowd. Use `.buttonStyle(.card)` or `.hoverEffect(.highlight)`, which adds a projection, a specular highlight and parallax within the focused view. Use `focusSection()` and `defaultFocus`. Don't show a free-moving pointer.
- **Keyboard focus** (iPadOS, macOS, visionOS). **FB-6** Focus is always visible: a ring on text and search fields, an accent highlight with white text on focused list rows (HIG Focus and selection), and an accent ring on custom controls on the web and macOS. Full Keyboard Access reaches every control, so on iPadOS don't make buttons, switches or segmented controls Tab-focusable yourself; support focus for content such as lists, collections and fields (HIG Keyboards). Move focus on submit with `@FocusState`. Make custom button-like views `focusable(interactions: .activate)` so they follow the system setting, and use `focusEffectDisabled()` only with a replacement. Give frequent commands keyboard shortcuts, and never repurpose standard ones; `buttonRepeatBehavior(.enabled)` also repeats while a shortcut is held. Esc and ⌘-period cancel alerts.
- **Digital Crown.** Every turn needs visible feedback, and updates should follow the rotation speed. Keep the default detents unless they fight your animation (HIG).

## 8. Outcome feedback

**FB-5** Confirm outcomes in place and in proportion to their significance, put errors inline next to their cause with a specific fix, and don't reach for toasts. **FB-9** Prefer undo to confirmation: confirm only uncommon, unexpected or irreversible loss, with a dialog anchored to its source.

| Situation                                 | Do                                                                                                                                                                                                                                                                                                                                                                       | Don't                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Routine success (toggle, add a row, send) | Let the result confirm itself: the row appears, the state flips.                                                                                                                                                                                                                                                                                                         | A toast or an alert.                                                                   |
| Significant success (payment, long task)  | Confirm in place: symbol replace or bounce (`motion.md` §7, SF Symbols animation), a label change, `.success` feedback, a VoiceOver announcement. Keep status in context, as Mail does in its toolbar.                                                                                                                                                                   | A modal "Success" alert.                                                               |
| The result lands off-screen               | Brief non-modal status near where people are looking and inside the safe area (LAY-1), plus an announcement (web: the optional `.status-pill` block). Apple's apps rarely use toasts; Mail's Undo Send bar is the familiar exception _(observed)_.                                                                                                                       | Timed messages that carry essential information (HIG: minimize time-boxed UI).         |
| Invalid input                             | Prevent it first: the right keyboard, a number formatter, Continue enabled only once required data is in (and say what's missing). Validate an email address when the field loses focus, and usernames and passwords before it does (HIG). Show an inline message beside the field with a specific fix, as an icon plus text in a text style (TYP-1), and play `.error`. | A red border alone; "Invalid input"; an alert for a field error.                       |
| Wrong passcode or password                | Shake the field (a few quick, damped horizontal oscillations; a system pattern _(observed)_), play `.error`, clear it. With Reduce Motion on, skip the shake and keep the haptic and message.                                                                                                                                                                            | An alert.                                                                              |
| A command can't run                       | Say why and what to do; Maps explains it can't route between identical points.                                                                                                                                                                                                                                                                                           | A silent no-op or an unexplained dead control.                                         |
| Critical, actionable problem              | An alert with a specific title and verb buttons.                                                                                                                                                                                                                                                                                                                         | Alerts for information.                                                                |
| Common, undoable delete                   | Do it, and offer Undo.                                                                                                                                                                                                                                                                                                                                                   | A confirmation every time (HIG Alerts).                                                |
| Uncommon, unexpected or irreversible loss | A confirmation dialog anchored to the button, with the destructive choice first and red, and Cancel present but never the default. A sheet swiped away with unsaved changes gets an action sheet.                                                                                                                                                                        | The destructive style on an action the person deliberately chose, such as Empty Trash. |
| Short wait                                | Keep the pressed or disabled state; nothing else.                                                                                                                                                                                                                                                                                                                        | A spinner that flashes.                                                                |
| Longer wait                               | An indicator in the control plus a progressive label; block repeats; determinate when you can; keep it moving; offer Cancel (and Pause if cancelling loses work); show placeholders, not a blank screen (HIG).                                                                                                                                                           | A blocking full-screen spinner; "Loading…".                                            |
| Empty or stale                            | `ContentUnavailableView` with the next step. Pull-to-refresh only supplements automatic refresh.                                                                                                                                                                                                                                                                         | A blank screen.                                                                        |
| Undo                                      | Multiple levels, each named ("Undo Delete"), with the result shown (scroll to it). iPhone: shake shows an Undo alert, and a three-finger swipe works too; Mac and iPad keyboards: ⌘Z and ⇧⌘Z, with Undo in the Edit menu. Add dedicated undo buttons only when necessary, using the standard symbols (**27**: `visibilityPriority` keeps them visible).                  | Redefining the undo gestures.                                                          |

**FB-7** Busy and loading feedback stays in the control (§2, Busy). To avoid a flashing spinner, show the indicator only after a short delay and keep it up long enough to read; the delay and minimum time are in `motion.md` §4 and §11 (heuristics, not Apple numbers). "The best content-loading experience finishes before people become aware of it" (HIG Loading).

## 9. Accessibility and hit regions

**FB-10** Every visual state has an accessible equivalent, and accessibility settings change the flourish, never the state.

- **State is data.** Give every custom control a purpose (label), a value, actions and feedback (WWDC26 _Refine accessibility for custom controls_): `.accessibilityValue`, `.accessibilityAddTraits(.isSelected)` (or `.isToggle`, `.isButton`), `.accessibilityAdjustableAction` for swipe-to-adjust values, and `.accessibilityAction(named:)` for multi-axis or gesture-only operations.
- **Announce outcomes** that neither move focus nor change the focused element: `AccessibilityNotification.Announcement("Saved").post()` (UIKit: `UIAccessibility.post(notification: .announcement, argument:)`). Set `accessibilitySpeechAnnouncementPriority` on an `AttributedString`; `.high` interrupts. During continuous changes, announce only when the value changed and at least 0.3 s have passed since the last announcement (WWDC26 220). Post a layout-changed notification for larger changes.
- **Gesture-rich controls** get `.accessibilityDirectTouch(options: [.requiresActivation, .silentOnTouch])`, plus custom actions for Switch Control and Voice Control.
- **Button Shapes and Show Borders**: read `@Environment(\.accessibilityShowBorders)`, the renamed `accessibilityShowButtonShapes` (macOS 27 adds a dedicated Show Borders setting), or `AXShowBordersEnabled()` from the Accessibility framework (26.1; it replaces `UIAccessibility.buttonShapesEnabled`). When it's true, draw visible edges on custom controls.
- **Differentiate Without Color** (`accessibilityDifferentiateWithoutColor`, `UIAccessibility.shouldDifferentiateWithoutColor`): carry state in a shape or symbol, such as a fill, checkmark or slash.
- **Reduce Motion**: keep every state change and drop scale, bounce and parallax (MOT-5). System glass already drops its elastic behavior; a custom press scale becomes a fill or opacity change (`motion.md` §12).
- **Reduce Transparency, Increase Contrast**: pressed and hover fills must stay visible on the opaque fallback, text in every state still meets CON-1 (check the CON-2 pairs while pressed), and glass glints turn off.
- **Reduce Bright Effects** (26.4): when `@Environment(\.accessibilityReduceHighlightingEffects)` is true, draw controls so highlighting and flashing are minimized; soften press highlights and glints and never flash.
- **Never single-channel**: pair audio cues with haptics and visuals, and don't auto-dismiss anything people need to read or act on (HIG Accessibility).

**FB-11** Measure the tappable box, not the glyph. The box is the control's frame plus its padding and any extension (a `contentShape`, a transparent `::after`, `.hit-extend`), and it must meet HIT-1 even when the visual is smaller: a 31–32 pt segmented control, a 28 pt switch, a sheet grabber, an icon-only button. Neighbouring extensions must not overlap; where they would, add spacing (HIT-2).

- **Native.** Size the target with padding or `frame(minWidth:minHeight:)`, then claim the whole frame with `.contentShape(_:)`; `.contentShape(_:_:)` sets a region per kind (`.interaction`, `.hoverEffect`, `.accessibility`, `.contextMenuPreview`, `.dragPreview`). UIKit: a larger frame, or `point(inside:with:)` for an invisible margin. To check, temporarily add `.border(.red)` right after those modifiers (it outlines the frame the shape fills) or read the frame in Xcode's view debugger.
- **Web.** `getBoundingClientRect()` returns the border box (padding included, pseudo-elements not). If both sides already reach `--hit`, you're done; otherwise the extension has to cover a `--hit` square centred on the control, which only hit-testing can show, because pseudo-elements have no DOM box:

```js
// true when a --hit square centred on el hit-tests to el (padding and ::before/::after count)
const hits = (
  el,
  size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hit')),
) => {
  const r = el.getBoundingClientRect(),
    x = r.left + r.width / 2,
    y = r.top + r.height / 2,
    h = size / 2 - 1;
  return [
    [-h, -h],
    [h, -h],
    [-h, h],
    [h, h],
  ].every(([dx, dy]) => el.contains(document.elementFromPoint(x + dx, y + dy)));
}; // scroll el into view first; false means too small, or a neighbour covers part of the square
```

## 10. Native recipes

SwiftUI first. These snippets typecheck against the iOS 26.2 SDK in Swift 5 and Swift 6 modes; iOS 27 APIs appear in text only. Numeric values are approximations; curves come from `motion.md` §3 (The spring model).

### 10.1 Button style with honest states

A custom button style with honest states (pressed, disabled, Show Borders, Reduce Motion). `ButtonStyle` keeps the platform's standard press tracking, including cancel on drag-off.

```swift
struct CapsuleActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityShowBorders) private var showBorders
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .padding(.horizontal, 20)
            .frame(minHeight: 44)                                   // hit box (HIT-1), not just the glyph
            .foregroundStyle(.white)                                // only on a dark tint (COL-3)
            .background(.tint, in: .capsule)
            .overlay(Capsule().fill(.black.opacity(configuration.isPressed ? 0.18 : 0)))
            .overlay { if showBorders { Capsule().strokeBorder(.primary, lineWidth: 1) } }
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(isEnabled ? 1 : 0.4)                           // dimmed, never hidden
            .contentShape(.capsule)
            .animation(configuration.isPressed ? .easeOut(duration: 0.09) : .snappy,
                       value: configuration.isPressed)             // press in fast, release on a spring (MOT-11)
    }
}
```

### 10.2 Busy, then success or error, in place

```swift
struct SaveButton: View {
    let save: @MainActor () async throws -> Void
    @State private var phase = Phase.idle
    @State private var successes = 0      // counters: a repeated outcome still changes the trigger
    @State private var failures = 0
    enum Phase { case idle, saving, saved }
    var body: some View {
        Button {
            Task {
                phase = .saving
                do {
                    try await save()
                    phase = .saved
                    successes += 1
                    AccessibilityNotification.Announcement("Saved").post()
                } catch {
                    phase = .idle
                    failures += 1            // also show why, inline (§8)
                }
            }
        } label: {
            HStack(spacing: 8) {
                if phase == .saving {
                    ProgressView()           // replaces the glyph; delay it for usually-short waits (FB-7)
                } else {
                    Image(systemName: phase == .saved ? "checkmark" : "square.and.arrow.down")
                        .contentTransition(.symbolEffect(.replace))
                }
                Text(phase == .saving ? "Saving…" : phase == .saved ? "Saved" : "Save")
            }
        }
        .disabled(phase == .saving)
        .sensoryFeedback(.success, trigger: successes)
        .sensoryFeedback(.error, trigger: failures)
    }
}
```

### 10.3 Repeating stepper with haptics

A custom stepper-like control that repeats on hold, ticks per value, taps more firmly at a limit, and is adjustable in VoiceOver:

```swift
struct QuantityControl: View {
    @Binding var quantity: Int
    let range: ClosedRange<Int>
    var body: some View {
        HStack(spacing: 12) {
            Button("Decrease", systemImage: "minus") { step(-1) }
                .disabled(quantity == range.lowerBound)
            Text(quantity, format: .number)
                .monospacedDigit()
                .contentTransition(.numericText(value: Double(quantity)))
            Button("Increase", systemImage: "plus") { step(1) }
                .disabled(quantity == range.upperBound)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.bordered)
        .buttonBorderShape(.circle)
        .buttonRepeatBehavior(.enabled)
        .sensoryFeedback(trigger: quantity) { _, new in
            new == range.lowerBound || new == range.upperBound ? .impact(weight: .light) : .selection
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Quantity")
        .accessibilityValue("\(quantity)")
        .accessibilityAdjustableAction { step($0 == .increment ? 1 : -1) }
    }
    private func step(_ delta: Int) { quantity = min(range.upperBound, max(range.lowerBound, quantity + delta)) }
}
```

### 10.4 Floating glass and toggle buttons

Glass floating over a map, and a toggle-style button (for pointer effects, add `.hoverEffect(.highlight)` or `.lift` with a matching `.contentShape(.hoverEffect, …)`, §7):

```swift
struct MapControls: View {
    @State private var locateTaps = 0
    var body: some View {
        GlassEffectContainer {            // neighbours share one container (GL-2)
            VStack(spacing: 12) {
                Button("Current Location", systemImage: "location.fill") { locateTaps += 1 }
                Button("Map Settings", systemImage: "map") { }
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)          // press, bounce, glow and pointer effect come built in
            .buttonBorderShape(.circle)
            .controlSize(.large)          // .extraLarge renders the same on iOS
        }
    }
}
struct FilterToggle: View {
    @Binding var isOn: Bool
    var body: some View {
        Toggle("Unread Only", systemImage: "line.3.horizontal.decrease", isOn: $isOn)
            .toggleStyle(.button)         // system on/off look and traits, outside a list
            .labelStyle(.iconOnly)
    }
}
```

### 10.5 Inline validation and focus

Inline validation with focus, and a default button:

```swift
struct SignInForm: View {
    enum Field { case email, password }
    @FocusState private var focus: Field?
    @State private var email = ""
    @State private var password = ""
    @State private var emailError: String?
    var body: some View {
        Form {
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .focused($focus, equals: .email)
                .onSubmit { focus = .password }
            if let emailError {
                Label { Text(emailError) } icon: {
                    Image(systemName: "exclamationmark.circle").foregroundStyle(.red)   // icon + text
                }
                .font(.footnote)
            }
            SecureField("Password", text: $password)
                .focused($focus, equals: .password)
            Button("Sign In") { }
                .keyboardShortcut(.defaultAction)
                .disabled(email.isEmpty || password.isEmpty)
        }
        .onChange(of: focus) { old, _ in if old == .email { validateEmail() } }  // on leaving the field
        .sensoryFeedback(.error, trigger: emailError) { _, new in new != nil }
    }
    private func validateEmail() { emailError = email.contains("@") ? nil : "Enter an email address like name@example.com." }
}
```

### 10.6 UIKit: in-button activity, haptics, scroll highlight

In-button activity, outcome haptics on a prepared generator, and instant highlight in a scroll view:

```swift
final class CheckoutViewController: UIViewController {
    private var isCheckingOut = false { didSet { checkout.setNeedsUpdateConfiguration() } }
    private lazy var outcome = UINotificationFeedbackGenerator(view: view)
    private lazy var checkout: UIButton = {
        var config = UIButton.Configuration.prominentGlass()     // the one prominent action (CMP-2)
        config.title = "Check Out"
        let button = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in self?.startCheckout() })
        button.configurationUpdateHandler = { [weak self] button in
            guard let self, var config = button.configuration else { return }
            config.showsActivityIndicator = self.isCheckingOut
            config.title = self.isCheckingOut ? "Checking Out…" : "Check Out"
            button.configuration = config
            button.isEnabled = !self.isCheckingOut
        }
        return button
    }()
    private func startCheckout() {
        isCheckingOut = true
        outcome.prepare()                             // before the outcome, not right at it
        Task { @MainActor in
            let ok = await submitOrder()
            isCheckingOut = false
            outcome.notificationOccurred(ok ? .success : .error)
            UIAccessibility.post(notification: .announcement, argument: ok ? "Order placed" : "Payment failed")
        }
    }
    private func submitOrder() async -> Bool { true }
}
final class ImmediateScrollView: UIScrollView {
    override init(frame: CGRect) { super.init(frame: frame); delaysContentTouches = false }
    required init?(coder: NSCoder) { super.init(coder: coder); delaysContentTouches = false }
    override func touchesShouldCancel(in view: UIView) -> Bool { true }   // a drag from a control still scrolls
}
```

For custom UIKit glass, create a `UIGlassEffect(style: .regular)` (regular by default, GL-4) and set its `isInteractive` to `true`; for pointer effects on a custom view, set `view.hoverStyle = UIHoverStyle(effect: .highlight, shape: .capsule)`.

### 10.7 visionOS control feedback

On visionOS 26, a custom toggle asks for the system's control feedback, a sound since visionOS has no haptics, like this; the same code plays nothing on other platforms:

```swift
struct CaptionsToggle: View {
    @Binding var isOn: Bool
    var body: some View {
        Button { isOn.toggle() } label: {
            Label("Captions", systemImage: isOn ? "captions.bubble.fill" : "captions.bubble")
        }
        .sensoryFeedback(.press(.toggle), trigger: isOn)
        .sensoryFeedback(trigger: isOn) { _, new in .selection(new ? .on : .off) }
        .accessibilityValue(isOn ? "On" : "Off")
    }
}
```

## 11. Web recipes

Every name below is defined by the kit: tokens in `assets/css/tokens.css`; state rules in the `states`, `field-message` and optional `status-pill` blocks (`assets/css/blocks/`); helpers in `AppleFeedback`, which `assets/js/apple-interactions.js` exports next to `AppleMotion`. Build with `scripts/build_kit.py` (WEB-1) rather than pasting kit CSS into answers; for single-file deliverables, `--inline` fills the page's `<style data-kit>` and `<script data-kit>` tags (web.md §1), and `--markup <blocks>` prints the markup to copy.

**Selector contract.** Use `:active` when there's no script, and `[data-pressed]` once `AppleFeedback.initPressStates()` runs; it also sets `:root[data-press-tracking]`. Hover applies only to fine pointers (FB-2).

```css
/* hover and press are an overlay on the element's own fill, so an author fill never hides them */
:root:not([data-press-tracking]) .pressable:not([aria-disabled='true']):active,
.pressable[data-pressed] {
  background-image: linear-gradient(var(--press-fill) 0 0);
}
@media (hover: hover) and (pointer: fine) {
  .pressable:not(:disabled, [aria-disabled='true']):hover {
    background-image: linear-gradient(var(--hover-fill) 0 0);
  }
}
.pressable:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
.pressable:is(:disabled, [aria-disabled='true']) {
  opacity: var(--state-disabled-opacity);
}
```

Why a script-set attribute rather than `:active` alone: `:active` can't express "dragged off but still down", a scroll has to cancel the press, and iOS Safari applies `:active` only when a touch listener is registered (Apple's Safari Web Content Guide). A page without the module adds that listener in one line, `document.addEventListener('touchstart', () => {}, { passive: true })`, which is what `AppleFeedback.enableActiveStates()` does. Remove the tap highlight (`-webkit-tap-highlight-color: transparent`) only where you draw your own pressed state. Put `touch-action: manipulation` on controls, which keeps panning and pinch-zoom but drops double-tap zoom; reserve `touch-action: none` for custom drag surfaces. The kit's control classes and `.pressable` set both.

**Markup.**

```html
<button class="btn-glass" type="button" aria-pressed="false">Filter</button>
<button class="btn-prominent" type="submit" aria-busy="true" aria-disabled="true">
  <span class="activity-indicator" aria-hidden="true" style="--motion-delay: 400ms"></span>Saving…
</button>
<label class="list__row"
  ><span class="list__label">Wi-Fi</span>
  <input class="switch" type="checkbox" role="switch" switch checked
/></label>
<input
  id="email"
  type="email"
  autocomplete="email"
  aria-invalid="true"
  aria-describedby="email-msg"
/>
<p id="email-msg" class="field-message" data-tone="error">
  <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" /></svg>
  Enter an email address like name@example.com.
</p>
```

The indicator is motion.md's `.activity-indicator`; its look and timing are motion's, and `--motion-delay` keeps fast saves from flashing it (FB-7). The kit hides it until the button is `aria-busy` and tints it with the label color. A busy button uses `aria-disabled`, not `disabled`, because disabling the focused button throws keyboard focus away; `AppleFeedback.initPressStates()` swallows clicks on anything that's `aria-disabled="true"`. The `role="switch"` attribute gives switch semantics in browsers that ignore the `switch` attribute. Put the field message's tone on the icon and border, never on the text: in light mode, system red, orange and green text fails CON-1 at footnote size.

**Press tracking with slop and cancel.** `AppleFeedback.initPressStates()` works like this. On pointer-down it sets `data-pressed` immediately; for touches on list rows it waits about 100 ms, so scrolling doesn't flash every row. Moving more than 24 px outside the element clears the pressed look, and coming back restores it. Releasing inside the element lets the native click act; releasing within the margin activates too, as in UIKit, and a duplicate native click is swallowed. `pointercancel` (a scroll taking over) clears everything. Enter and Space show the pressed look for keyboard users.

```html
<script type="module">
  import { AppleFeedback } from './apple-interactions.js';
  AppleFeedback.initPressStates(); // data-pressed with slop, scroll cancel, row delay, keyboard parity
  AppleFeedback.initGlassGlint(); // --px/--py: light starts under the finger and follows a fine pointer
  document.querySelector('#save').addEventListener('click', async () => {
    await save();
    AppleFeedback.announce('Saved'); // polite live region (#feedback-status); { assertive: true } for errors
  });
</script>
```

**Keyboard parity.** Use `<button>`, `<a href>` and `<input>`. Enter activates buttons and links; Space activates buttons on release and toggles checkboxes and switches; arrow keys move within a radio group, which is how the kit's segmented control works. A custom element needs `tabindex="0"`, a role and the same key handling, so prefer the native element.

**Haptics on the web.**

| Mechanism                        | Safari (macOS, iOS)                                                                                                                                                   | Chrome and Edge                                                  | Firefox                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| `navigator.vibrate()`            | Not supported                                                                                                                                                         | Android: only inside a user gesture, not in cross-origin iframes | Removed on desktop in 129; a no-op on Android |
| `<input type="checkbox" switch>` | Native switch since 17.4. **iOS 18+ plays the Settings-style tap when the user toggles it** (WebKit); macOS plays trackpad haptics while it's dragged (WebKit source) | Plain checkbox                                                   | Plain checkbox                                |

- Put the `switch` attribute on real, visible switches bound to real settings. That's its purpose, and iPhone users get native feedback for free. In WebKit's source the haptic doesn't depend on the native appearance, so the kit's styled `.switch` should keep it _(unverified)_.
- Don't fake haptics with hidden switches. WebKit made switch haptics require user activation in January 2025 ("It should not be possible to generate haptic feedback from script alone"), then accept trusted events only in May 2026 (WebKit bug 309082); community reports say this shipped in iOS 26.5 _(unverified)_. Overlays that route taps on other buttons to a hidden switch still work, but they play a toggle haptic for a non-toggle action, add a hidden form control, and can break scrolling. Treat them as unsupported.
- `navigator.vibrate` isn't an Apple-platform feature. If you use it on Android at all, keep it to one short pulse for an outcome, inside the user's event handler, with a setting to turn it off, and never as the only signal.

**Sound on the web.** There are no system UI sounds, and Web Audio needs a user gesture before it can start. Safari 16.4+ supports `navigator.audioSession.type = "ambient"` (W3C draft: mixable, nonessential audio); whether iOS then honors the Silent switch is _(unverified)_. Keep UI sounds off by default.

**Hit area.** Add `.hit-extend` to controls whose visual box is smaller than `--hit`: segment labels, the sheet grabber, the switch. Its transparent `::after` grows the target without changing layout, so it can't go on the glass classes, which already use both pseudo-elements. Check the result with `hits()` (FB-11, §9).

**Glass glint and preferences.** `AppleFeedback.initGlassGlint()` sets `--px` and `--py` on the glass surface under the pointer, and the kit's sheen reads them together with `--glow`. Pressing an item in a `.toolbar-group` or `.tabbar` lights the whole group, the way light spreads to nearby glass. Reduced motion sets `--press-scale` to 1 and keeps the fills; `prefers-contrast: more` strengthens fills, makes the focus ring opaque and turns `--press-glow` and `--hover-glow` off. `prefers-reduced-transparency` does the same only in Chromium: Safari and iOS Safari don't support it (WEB-2), so every pressed, hover and selected state must stay legible on live glass without that fallback.

## 12. Anti-patterns

| Anti-pattern                                                                   | Why it fails                                                                             | Do instead                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Hover-only affordances; `:hover` not gated to fine pointers                    | Touch has no hover: actions go unfound, and hover sticks after a tap                     | Visible actions, swipe actions or a context menu; gate hover (FB-2)                                            |
| No pressed state, or one that appears on click or release                      | Feels dead; people tap twice                                                             | Pressed on touch-down (FB-1)                                                                                   |
| A haptic on every tap, on top of a system control's, or with the wrong meaning | Numbs or teaches the wrong meaning; double-fires                                         | One semantic haptic per meaningful outcome (FB-4)                                                              |
| Toasts for everything; auto-dismissing errors                                  | Missed, not accessible, time-boxed                                                       | Confirm in place; errors inline (FB-5)                                                                         |
| Unexplained disabled controls; disabled or hidden tabs                         | Looks broken; hides what's required; navigation shifts                                   | Say what's missing (`aria-disabled` keeps it focusable on the web); explain empty states inside the tab (FB-3) |
| Spinners that flash; blocking full-screen spinners; "Loading…"                 | Jittery; loses context                                                                   | A delayed indicator inside the control, with a specific label (FB-7)                                           |
| Color-only state (a red border, a tint-only selection)                         | Fails color-blind and monochrome users                                                   | Add a shape, symbol or text (COL-2)                                                                            |
| `outline: none` with no replacement                                            | Keyboard users get lost                                                                  | `:focus-visible` ring or row highlight (FB-6)                                                                  |
| Judging hit areas by the visible shape; scaling list rows on press             | Small controls miss HIT-1; scaled rows crowd neighbors                                   | Measure the tappable box (FB-11); a fill highlight for rows                                                    |
| Interactive glass on static surfaces                                           | A false affordance                                                                       | `interactive()` only on controls (FB-12)                                                                       |
| Confirming undoable actions; a destructive default button                      | Autopilot "OK"; accidental loss                                                          | Undo; Cancel as the safe path (FB-9)                                                                           |
| Custom long-press timers for context menus; double tap on single-tap targets   | Wrong timing and haptics; a double-tap recognizer delays every single tap by about 0.5 s | System context menus; avoid double tap                                                                         |
| Faking iOS haptics on the web with hidden switches                             | Unsupported, and WebKit keeps closing the loopholes                                      | The `switch` attribute on real switches only                                                                   |

## 13. Sources and verification

- Apple HIG (JSON behind each page, retrieved 2026-09-30): Feedback, Playing haptics, Playing audio, Buttons, Toggles, Sliders, Segmented controls, Steppers, Pickers, Text fields, Search fields, Entering data, Pointing devices, Focus and selection, Eyes, Remotes, Digital Crown, Gestures, Keyboards, Loading, Progress indicators, Undo and redo, Drag and drop, Menus, Context menus, Lists and tables, Tab bars, Toolbars, Sheets, Alerts, Action sheets, Materials, Motion, Accessibility, VoiceOver: https://developer.apple.com/design/human-interface-guidelines/
- API documentation (developer.apple.com/documentation, JSON retrieved 2026-09-30):
  - SwiftUI: `SensoryFeedback` (every case and its "only plays on" note; `press(_:)`, `release(_:)`, `selection(_:)`), `sensoryFeedback(_:trigger:)` and its `condition:` and closure variants, `ButtonStyle`, `PrimitiveButtonStyle`, `buttonRepeatBehavior(_:)`, `HoverEffect`, `hoverEffect(_:isEnabled:)`, `contentShape(_:_:eoFill:)`, `focusable(_:interactions:)`, `focusEffectDisabled(_:)`, `KeyboardShortcut.defaultAction`, `swipeActions(edge:allowsFullSwipe:content:)` and the 27 `onPresentationChanged:` form, `swipeActionsContainer()`, `reorderable()`, `GestureInputKinds`, `refreshable(action:)`, `accessibilityShowBorders`, `pointerStyle(_:)`, `CardButtonStyle`, `Glass.interactive(_:)`, `ControlSize.extraLarge`, _Applying Liquid Glass to custom views_, _Adopting Liquid Glass_, the SwiftUI, UIKit, AppKit and Accessibility updates pages.
  - UIKit: `UIFeedbackGenerator` (and `prepare()`, `init(view:)`), `UIImpactFeedbackGenerator`, `UISelectionFeedbackGenerator`, `UINotificationFeedbackGenerator`, `UICanvasFeedbackGenerator`, `UIGlassEffect.isInteractive`, `UIScrollView.delaysContentTouches`, `UISwipeActionsConfiguration.performsFirstActionWithFullSwipe`, `UIDragInteraction.liftBehavior` and `allowsPointerDragBeforeLiftDelay` (27), `UIDevice.playInputClick()`; _Playing haptic feedback in your app_.
  - Other frameworks: AppKit `NSHapticFeedbackManager`, `NSHapticFeedbackPerformer`, and `NSGlassEffectView.effectIsInteractive` (27); watchOS `WKHapticType`; Core Haptics `CHHapticEngine` and _Preparing your app to play haptics_; Accessibility `AccessibilityNotification.Announcement`; RealityKit `HoverEffectComponent`; AudioToolbox `AudioServicesPlaySystemSound(_:)` and `AudioServicesPlayAlertSound(_:)`; AVFAudio `AVAudioSession.Category.ambient`.
  - SDK interfaces checked directly (Xcode 26.3, 26.2 SDKs): SwiftUI, SwiftUICore and UIKit `.swiftinterface` files; the UIKit headers `UIFeedbackGenerator.h`, `UIImpactFeedbackGenerator.h`, `UIControl.h`, `UIScrollView.h`, `UILongPressGestureRecognizer.h`, `UIStepper.h`, `UISlider.h`, `UISliderTrackConfiguration.h`, `UIGlassEffect.h`, `UIPointerStyle.h`, `UIHoverStyle.h`; Accessibility `AXSettings.h`; AppKit `NSHapticFeedback.h`; WatchKit `WKInterfaceDevice.h`.
  - Runtime measurements (iOS 26.3 Simulator, iPhone 17, 2026-09-30): `UISwitch` / SwiftUI `Toggle` (63×28 pt capsule track, 37×24 pt Liquid Glass lens knob), `UISegmentedControl` 32 pt / `Picker(.segmented)` 31 pt, inset-grouped rows ≈53 pt, `.extraLarge` = `.large`. No 27 runtime was available; 27 isn't documented as changing these metrics _(unverified)_.
- WWDC: 2018 _Designing Fluid Interfaces_ (803); 2019 _Introducing Core Haptics_ (520), _Designing Audio-Haptic Experiences_ (810); 2020 _Design for the iPadOS pointer_ (10640); 2023 _Design for spatial input_ (10073); 2024 _Squeeze the most out of Apple Pencil_ (10214), _Create custom hover effects in visionOS_ (10152); 2025 _Meet Liquid Glass_ (219), _Get to know the new design system_ (356), _Build a SwiftUI app with the new design_ (323), _Build a UIKit app with the new design_ (284), _Build an AppKit app with the new design_ (310); 2026 _Principles of great design_ (250), _Refine accessibility for custom controls_ (220), _What's new in SwiftUI_ (269), _Modernize your AppKit app_ (289), _Code-along: Build powerful drag and drop in SwiftUI_ (271), _Make your game great with touch_ (358). https://developer.apple.com/videos/
- Web: WebKit blog _WebKit Features in Safari 18.0_ (switch haptics): https://webkit.org/blog/15865/webkit-features-in-safari-18-0/ · WebKit commits 271686@main (macOS switch haptics), 276727@main (haptics on click), 288403@main (require user activation), fc1ef83 (bug 309082, trusted events only), and `Source/WebCore/html/CheckboxInputType.cpp`: https://github.com/WebKit/WebKit · MDN browser-compat-data for `Navigator.vibrate`, `input` `switch`, `Navigator.audioSession`, `:focus-visible`, the `hover` media feature, `prefers-reduced-transparency` (no Safari support) and `touch-action`: https://github.com/mdn/browser-compat-data · W3C Audio Session draft: https://www.w3.org/TR/audio-session/ · Apple _Safari Web Content Guide_ (archived; `:active` needs a touch handler).

Unverified or observed (not in Apple documentation): the tab-bar press-and-slide lens, haptics at the swipe-action full-swipe point, pull-to-refresh arming, context-menu presentation and drag lift, the size of UIKit's tracking margin, SwiftUI's scroll-view highlight delay, the passcode shake pattern, 27's glass context menus, whether Core Haptics honors the system Haptics switch, iOS Silent-switch behavior for web audio, the iOS version that shipped WebKit's trusted-event fix, the styled web switch keeping its haptic on a device, and all numeric press values (scale, dim, delays) used in the recipes.
