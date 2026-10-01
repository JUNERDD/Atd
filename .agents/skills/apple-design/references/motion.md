# Motion: how Apple interfaces move (Liquid Glass era)

Current as of **2026-09-30** (iOS, iPadOS, macOS, watchOS, tvOS and visionOS **27**; Liquid Glass since 26). This file owns _how things move_: springs, curves, transitions, choreography, gesture physics, loading motion and the Reduce Motion policy. Other owners are cited by rule ID: control states, haptics and outcomes in interaction-feedback.md (FB), which takes its curves from here; the material in liquid-glass.md (GL); hit targets and contrast in foundations.md (HIT, CON); API spellings and availability in swiftui.md (NAT-3); the web kit in web.md (WEB-1). Labels: (heuristic) is this skill's recommendation where Apple publishes no number; (observed) is shipping behavior Apple doesn't document; (unverified) means not confirmed in an Apple primary source.

## Rules at a glance

| ID     | Rule                                                                                                                                                                                                                                           | Why                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| MOT-1  | Motion explains something: feedback, a relationship, or a change of state. Keep it brief; never decorative, never the only signal, never something people wait for.                                                                            | Gratuitous motion distracts, slows frequent tasks, and can make people physically uncomfortable (HIG Motion).               |
| MOT-2  | Springs by default, from the preset table (§3): `.smooth` / `.snappy` / `.bouncy` ↔ CSS tokens ↔ `AppleMotion`. Bounce only for gesture-driven or celebratory moments.                                                                         | Springs retarget mid-flight and keep their velocity; one shared set makes native and web feel like the same object.         |
| MOT-3  | Interruptible and gesture-driven: track 1:1, hand the release velocity to the spring, project the end point, rubber-band at limits, and never drop input during a transition.                                                                  | People feel any lag or hitch at the handoff, and grabbing something mid-flight must just work.                              |
| MOT-4  | Spatial continuity: things morph out of their source and leave the way they came.                                                                                                                                                              | The path tells people where something lives and how to get back to it.                                                      |
| MOT-5  | Reduce Motion: substitute, don't delete. Keep short opacity and color fades and essential feedback (progress, state, focus); remove translation, scale, bounce, parallax, depth and blur animation. Glass morphs stay, without bounce (MOT-9). | Motion-sensitive people still need to see what changed; a frozen spinner reads as a hang.                                   |
| MOT-6  | Web: animate only `transform` and `opacity`; never animate `backdrop-filter` or blur radii.                                                                                                                                                    | Those two run on the compositor; blur and layout re-render every frame and drop frames on phones.                           |
| MOT-7  | Bounce budget: no visible bounce for taps, state changes and presentations (0, or `.snappy`'s 0.15 at most); 0.15–0.2 when a gesture releases with momentum; 0.3 rarely, for celebration; never above ~0.4.                                    | Overshoot implies momentum; without a flick it reads as wobble and slows every repeat.                                      |
| MOT-8  | Decide a released gesture's outcome from its projected end point, not its current position.                                                                                                                                                    | One test covers both a long, slow drag and a short, fast flick.                                                             |
| MOT-9  | Glass materializes and morphs; it never fades, and neighboring glass moves as one shape.                                                                                                                                                       | Opacity fades and separate animations break the illusion of one continuous liquid layer.                                    |
| MOT-10 | Choose a symbol effect for what it means (state change, "it happened", ongoing activity, emphasis), and use few.                                                                                                                               | Effects are a vocabulary; used as decoration they stop meaning anything.                                                    |
| MOT-11 | Press in fast, release on a spring: the pressed look lands on touch-down, and the release springs back.                                                                                                                                        | A press that rides a slow spring feels late: a real 100 ms tap reached only 58 % of the pressed depth (measured in Chrome). |
| MOT-12 | One primary motion per moment; secondary elements ride the same spring; stagger only to show grouping, 150 ms in total at most (heuristic).                                                                                                    | Competing timelines read as noise and delay the content.                                                                    |
| MOT-13 | Loading motion: placeholders at once; a spinner only after ~300–500 ms, then kept ~500 ms (heuristic); indicators never freeze.                                                                                                                | A flashing spinner reads as a glitch, a frozen one as a hang.                                                               |
| MOT-14 | visionOS comfort: no motion in the periphery, a stationary frame of reference, no sustained oscillation; fade out and back in to relocate.                                                                                                     | In a headset, motion people don't cause themselves can make them feel sick.                                                 |

## Contents

1. Principles · 2. What changed in 26 and 27 · 3. The spring model · 4. Timing guide
2. Transitions and choreography · 6. Liquid Glass motion · 7. SF Symbols animation · 8. Content transitions
3. Scroll-linked motion · 10. Gesture-driven motion · 11. Loading and progress · 12. Reduce Motion and related settings
4. Platform notes · 14. Web recipes · 15. Anti-patterns · 16. Sources

---

## 1. Principles

**The fluid-interface model** (WWDC18 "Designing Fluid Interfaces") explains most of Apple's motion decisions.

| Principle                            | In practice                                                                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Respond instantly                    | People notice even small lag. Highlight on touch-down, start motion on the first input event, and never wait on a timer to guess intent.                                                                             |
| Track 1:1                            | While a finger or pointer drives something, the content moves exactly with it. When tracking slips, people notice immediately.                                                                                       |
| Interruptible, redirectable          | Any motion can be grabbed, reversed or retargeted mid-flight. Gesture and thought run in parallel: you can swipe home and then straight into the app switcher.                                                       |
| Velocity continuity                  | Hand the gesture's momentum to the animation, and keep velocity when you retarget, so there's no hitch at the handoff. Springs can do this; fixed curves can't.                                                      |
| Spatial consistency                  | Things leave the way they came, on a consistent path. A view revealed by sliding down is dismissed by sliding up.                                                                                                    |
| Hint in the direction of the gesture | A little preview motion teaches what a gesture will do. For example, a control that needs a firmer press gives a small bounce on tap.                                                                                |
| Behavior, not animation              | Think in elastic behaviors (springs), not durations; a spring is always ready to head somewhere new. Keep one family of behaviors, so that scrolling by finger and animated scroll-to-top feel like the same object. |
| Good frames                          | Smoothness is also about what each frame shows. Very fast movement strobes at any frame rate. In the talk, the iPhone X app-launch animation stretched the icon slightly to carry motion information between frames. |

**HIG Motion** (revised September 2025 for Liquid Glass):

- **MOT-1** Add motion only when it has a purpose; gratuitous motion distracts and can make people physically uncomfortable. Make it optional: never the only carrier of information, always paired with haptics, audio or text.
- Feedback motion should be realistic, follow the gesture, and stay brief and precise. Don't animate frequent interactions (the system already animates standard controls). Let people cancel; never make them wait for an animation, especially one they see often.
- System components tune their motion to the input method: Liquid Glass reacts more strongly to direct touch than to a trackpad.

**Liquid Glass motion** (WWDC25 "Meet Liquid Glass"): the look and the motion were designed together. Glass reacts at the fingertip and settles back like a gel, materializes instead of fading, morphs between states, lifts a control into glass only while it's touched, and acts thicker as it grows; Reduce Motion lowers the intensity and turns off the elasticity. The material properties are defined in liquid-glass.md §2; how to animate them is §6 here.

**WWDC26.** Craft includes responsive animations that feel fluid and give immediate, natural feedback. Delight comes from the whole experience, not flourishes added at the end, and motion should reinforce hierarchy. Dropped frames and slow loads hurt how an app feels even when people can't say why (WWDC26 "Principles of great design", "Communicate your brand identity on iOS").

## 2. What changed in 26 and 27

Motion deltas only. The dated design timeline is liquid-glass.md §1; API spellings, SDK deltas and availability are in swiftui.md (API index, NAT-3).

- **26:** glass materializes, morphs and reacts to touch (§6); push/pop became fully interruptible, with back-swipe anywhere in the content (§5); menus, popovers, alerts and dialogs morph out of their glass control, and sheets can zoom out of a bar button (§5); the tab bar minimizes on scroll (§6); SF Symbols 7 adds Draw On/Off and Variable Draw (§7).
- **26.4:** SwiftUI environment values for Prefer Cross-Fade Transitions and Reduce Bright Effects (§12).
- **27:** navigation bars minimize on scroll too (§6); sheets and navigation can cross-fade instead of sliding, except on macOS (§5); interactive glass on macOS bounces subtly on click (§6, §13); SF Symbols 8 adds symbols, but no new animation presets appear in Apple's pages (§7).

## 3. The spring model

**MOT-2** Apple's default motion is a spring, described by two perceptual parameters. **duration** is the pace in seconds, not the time until the spring comes to rest. **bounce** runs from −1 to 1: 0 is critically damped (no overshoot), above 0 is bouncier (1 oscillates forever), and below 0 approaches more flatly (overdamped).

**The physics** (mass 1): ω₀ = 2π / duration. Damping ratio ζ = 1 − bounce when bounce ≥ 0, or 1 / (1 + bounce) when bounce < 0. Stiffness = ω₀² and damping = 2ζω₀ (= 4π(1 − bounce) / duration). These were checked numerically against SwiftUI's `Spring.value(…)`; the formula as printed on the WWDC23 session page is garbled. The legacy `.spring(response:dampingFraction:)` maps as response ≈ duration and dampingFraction = 1 − bounce.

| SwiftUI                       | Parameters                                                                   | ζ     | Overshoot | `Spring.settlingDuration` |
| ----------------------------- | ---------------------------------------------------------------------------- | ----- | --------- | ------------------------- |
| `.smooth`                     | duration 0.5, bounce 0                                                       | 1.0   | 0         | 0.80 s                    |
| `.snappy`                     | duration 0.5, bounce 0.15                                                    | 0.85  | ≈0.6 %    | 0.88 s                    |
| `.bouncy`                     | duration 0.5, bounce 0.3                                                     | 0.70  | ≈4.6 %    | 1.04 s                    |
| `.default` (iOS 17 and later) | `spring(response: 0.55, dampingFraction: 1.0)`; before 17 it was `easeInOut` | 1.0   | 0         | —                         |
| `.spring`                     | response 0.5, dampingFraction 0.825                                          | 0.825 | ≈1 %      | —                         |
| `.interactiveSpring`          | response 0.15, dampingFraction 0.86, blendDuration 0.25                      | 0.86  | —         | —                         |

Libraries that take stiffness and damping (mass 1) get the three presets as stiffness 157.9 with damping 25.1 (`.smooth`), 21.4 (`.snappy`) or 17.6 (`.bouncy`), as read from SwiftUI's `Spring`.

- **Tune and pick values.** `.snappy(duration: 0.3)` changes the pace, and `.bouncy(extraBounce: 0.1)` adds to the preset's base bounce. Choose a duration for pacing first, then bounce for character (WWDC23): about 0.15 feels brisk rather than bouncy, 0.3 is noticeably bouncy, and above about 0.4 is too exaggerated for UI.
- **Perceptual vs settling duration.** `duration` stays predictable, while the settling time is longer and varies, so don't gate UI on it. `withAnimation(_:completionCriteria:_:completion:)` defaults to `.logicallyComplete`, which fires when the motion is perceptually done; `.removed` waits for the whole tail.
- **Interruption.** A new spring on the same property retargets the running one and keeps its velocity. Timing curves such as `easeInOut` are combined additively instead, which reads less naturally when interrupted. Use springs for anything that can be interrupted.

```swift
withAnimation(.snappy) { expanded.toggle() }                          // 0.5 s, bounce 0.15
withAnimation(.spring(duration: 0.4, bounce: 0.2)) { offset = .zero }  // custom spring: snap back after a fling
withAnimation(.smooth) { expanded = true } completion: { showDetails = true }
// UIKit/CA: velocities are NORMALIZED — points per second ÷ remaining distance, per axis.
UIView.animate(springDuration: 0.5, bounce: 0.15, initialSpringVelocity: dy == 0 ? 0 : v.y / dy,
               options: [.allowUserInteraction]) { card.center = target }
UIView.animate(.spring(duration: 0.5)) { bead.center = target }       // iOS 18: SwiftUI Animation drives UIKit
let pop = CASpringAnimation(perceptualDuration: 0.5, bounce: 0.15)     // sets its own duration to the settling time
// Also: UISpringTimingParameters(duration:bounce:initialVelocity:) (iOS 17) for UIViewPropertyAnimator.
```

**MOT-7** Bounce budget (WWDC18, WWDC23):

| Situation                                                                                                                             | bounce                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Default: state changes, taps, presentations with no momentum (Now Playing presents on tap with 100 % damping)                         | 0 (`.smooth`), or 0.15 (`.snappy`: brisk, not visibly bouncy) |
| Release of a gesture that carries momentum, such as a fling or swipe to dismiss (Now Playing's swipe-dismiss uses about 80 % damping) | 0.15–0.2                                                      |
| Brisk, not visibly bouncy                                                                                                             | 0.15 (`.snappy`)                                              |
| Playful, celebratory or physical moments                                                                                              | 0.3 (`.bouncy`), rarely                                       |
| Hinting that a firmer gesture is needed                                                                                               | a small bounce                                                |
| Reduce Motion is on                                                                                                                   | 0, always                                                     |

**From springs to CSS.** CSS can't simulate a spring, but `linear()` can sample one. A spring's shape scales with its duration, so one sampled curve per bounce value works at any pace: the CSS duration is the perceptual duration × a _settle factor_. Curves are sampled until they stay within 0.1 % of the target, and the tokens are accurate to within 0.3 %.

| SwiftUI                   | CSS easing             | CSS duration                        | Settle factor |
| ------------------------- | ---------------------- | ----------------------------------- | ------------- |
| `.smooth`                 | `var(--spring-smooth)` | `var(--dur-spring-smooth)` = 740 ms | 1.48          |
| `.snappy`                 | `var(--spring-snappy)` | `var(--dur-spring-snappy)` = 700 ms | 1.40          |
| `.bouncy`                 | `var(--spring-bouncy)` | `var(--dur-spring-bouncy)` = 820 ms | 1.64          |
| `.snappy(duration: 0.29)` | `var(--spring-snappy)` | `var(--dur-slow)` = 400 ms          | 1.40          |

In JS, `AppleMotion.springAt()` and `AppleMotion.springEasing()` (§14) implement the same model and match `Spring.value` to 4 decimal places. Use them for other bounce values, or to start a curve with an initial velocity (`{ duration, bounce, velocity }`, with velocity as a fraction of the distance per second).

## 4. Timing guide

Apple publishes defaults, not a table of durations for each moment. System defaults to calibrate against: SwiftUI presets 0.5 s perceptual; `.default` spring response 0.55; `easeInOut` 0.35 s; Core Animation implicit animations 0.25 s; UIKit navigation-bar show/hide 0.2 s; `interactiveSpring` response 0.15. Durations below that don't come from those defaults are (heuristic).

| Moment                                                                                               | Native                                                                                                                        | Web                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Press and release** (MOT-11; touch timing: interaction-feedback.md §3)                             | Pressed look at once on touch-down; the release springs back with `.snappy`                                                   | Press-in `var(--dur-press)` + `var(--curve-out)`; release `var(--dur-spring-snappy)` + `var(--spring-snappy)` |
| **Control state change** (toggle knob, segmented thumb, selection). Never bounce a plain state flip. | System control; if custom, `.snappy`                                                                                          | Slide on `var(--dur-spring-snappy)` + `var(--spring-snappy)`                                                  |
| **In-place value or text change**                                                                    | `.contentTransition(.numericText(value:))` inside `withAnimation`                                                             | Cross-fade in ≤ `var(--dur-base)`                                                                             |
| **Navigation push/pop**                                                                              | System (interruptible); if custom, `.smooth`                                                                                  | View Transition, `var(--dur-spring-smooth)`                                                                   |
| **Sheet present, detent change** (no bounce when a tap drives it)                                    | System; if custom, `.smooth` / `.snappy`                                                                                      | `.sheet` at `var(--dur-spring-smooth)`                                                                        |
| **Sheet dismissed by drag**                                                                          | Spring starting at the drag's velocity: bounce 0 going off-screen, 0.2 when it snaps back                                     | `AppleMotion.animateSpring` (§14.5)                                                                           |
| **Menu, popover, alert, dialog** (exits quicker than entrances (heuristic))                          | System morph out of the source control                                                                                        | `AppleMotion.morph()` or `.motion-pop`; exit uses `var(--dur-fast)`                                           |
| **Tab switch**                                                                                       | Content swaps in place; only the selection indicator moves (observed)                                                         | Swap content instantly; slide `.tabbar__indicator` on the snappy pair. Never fade the selection.              |
| **Toast-style banner** (HIG discourages timed, auto-dismissing UI; FB-5)                             | Prefer system notifications or Live Activities. If custom: `.snappy` in, `.smooth` out, never auto-dismiss important content. | `.motion-pop` with `--motion-origin: top`                                                                     |
| **Large-title collapse, scroll edge**                                                                | System, tied to scroll position                                                                                               | Scroll-driven animation, no duration                                                                          |
| **Ambient loop** (waiting, idle)                                                                     | `PhaseAnimator` with `easeInOut` of about 1 s is fine                                                                         | CSS animation, paused off-screen                                                                              |
| **Spinner appearance** (MOT-13)                                                                      | Show after about 300–500 ms, then keep it at least about 500 ms (heuristic)                                                   | `.activity-indicator` with `--motion-delay`                                                                   |

**MOT-11** Press in fast, release on a spring. The pressed look must land while the finger is still down: a real 100 ms tap on a control whose press rode a 0.4 s spring reached only 58 % of its depth (measured in Chrome). Natively, highlights change at once; a custom press scale takes a quick ease-out going in and `.snappy` coming back, e.g. `.animation(configuration.isPressed ? .easeOut(duration: 0.09) : .snappy, value: configuration.isPressed)` in a `ButtonStyle` (heuristic). The pressed look itself is interaction-feedback.md §10.1 (FB-1). The web kit uses the same pair: `--dur-press` (90 ms) with `--curve-out` going in, and the snappy spring coming back.

## 5. Transitions and choreography

- **MOT-4** Every transition should answer where the thing came from and where it went. A presented view dismisses back into its source, along the path it came in on; don't swap directions between presenting and dismissing.
- **Push and pop.** Use `NavigationStack` / `UINavigationController`. Since 26 the slide is interruptible and back-swipe starts anywhere in the content. In UIKit, custom horizontal gestures must set failure requirements on `interactiveContentPopGestureRecognizer` (swipe actions already take priority). Transitions can start at any time, and in UIKit an interrupted push completes and turns into a pop, so never drop a tap because a transition is running.
- **Zoom** (iOS 18 and later), when a large cell or thumbnail opens into its detail. Put `matchedTransitionSource(id:in:)` on the source and `.navigationTransition(.zoom(sourceID:in:))` on the destination. It works for push, `sheet` and `fullScreenCover`, and stays interactive so people can drag it closed. In UIKit, `preferredTransition = .zoom { ctx in … }` runs its closure on zoom-in and again on zoom-out: capture a stable ID and return the _current_ source view.
- **Sheets** rise from the bottom edge and settle on their detents with a spring, and people expect to swipe down to dismiss (§10). How the material changes between detents is liquid-glass.md §10; detents, grabber and buttons are CMP-5. In 27, `.crossFade` fades a sheet in over the content instead (not on macOS): use it for lightweight overlays and when Prefer Cross-Fade Transitions is on.
- **Menus, popovers, alerts, action sheets and confirmation dialogs** morph out of their presenting control. Attach the modifier to that control, not to a distant ancestor, so the morph anchors correctly. If a popover changes size, animate the change so it doesn't look like a new popover replaced the old one.
- **Full-screen covers** slide up, or zoom from a source. Always give an explicit way to dismiss.
- **Lists.** Change the data inside `withAnimation` and the list animates rows in, out and between positions. For drag reordering use `onMove`, or in 27 `reorderable()` plus `reorderContainer(for:…)` on any container. Don't animate every row on first load.
- **`matchedGeometryEffect`** moves an element within one view hierarchy; exactly one view per ID may be `isSource: true`. Between screens, use zoom.
- **MOT-12** Have one primary motion per moment; secondary elements ride the same transaction (same spring) instead of starting their own timelines. Springs that start and settle at slightly different times read as natural (WWDC23). Stagger only to show grouping or sequence: 20–40 ms per item, 150 ms total at most (heuristic), and none under Reduce Motion. On the web, `.motion-stagger` does this, with `--motion-index` set on each child.

```swift
NavigationLink(value: photo) { Thumb(photo: photo).matchedTransitionSource(id: photo.id, in: ns) }
// destination:
PhotoDetail(photo: photo).navigationTransition(.zoom(sourceID: photo.id, in: ns))
// iOS 27 SDK (from Apple's docs; not compiled here): cross-fade a sheet when people prefer it.
.sheet(isPresented: $show) {
    Settings().navigationTransition(prefersCrossFade ? AnyNavigationTransition(.crossFade)
                                                     : AnyNavigationTransition(.automatic))
}
```

## 6. Liquid Glass motion

**MOT-9** Glass appears by materializing and changes by morphing; it never fades, and neighboring pieces move as one shape. The properties being animated (lensing, glow, thickness) are defined in liquid-glass.md §2.

- **Morphing.** Wrap nearby glass in `GlassEffectContainer(spacing:)`, give each piece `glassEffectID(_:in:)`, and change the hierarchy inside `withAnimation`. Shapes closer than `spacing` blend together, and the default `.matchedGeometry` transition grows a new shape out of its nearest neighbor. For glass farther apart than `spacing`, use `glassEffectTransition(.materialize)`; `.identity` means no transition. Apple asks you to use `matchedGeometry` and `materialize` consistently. IDs and transitions only act during animated hierarchy changes.
- **Merging at rest.** `glassEffectUnion(id:namespace:)` merges pieces with the same shape and glass variant into one. A container spacing larger than the stack's spacing also merges shapes that aren't moving. `.glassEffect(on ? .regular : .identity)` switches glass on and off without changing layout.
- **Interactive glass** animates its own press response (liquid-glass.md §5), including the macOS 27 click bounce (`effectIsInteractive`). Add `.interactive()` only to custom glass that people press (FB-12); the standard glass button styles already include it, so add no press scale of your own (FB-8).
- **Bars.** Tab bars (26) and navigation bars (27) can minimize while scrolling. A minimized tab bar returns when you scroll back, tap a tab or scroll to the top. Use `.onScrollUp` for bottom-anchored content such as chat. The bottom accessory moves inline when the tab bar minimizes. A search tab morphs into the search field, a bottom search field slides up with the keyboard when focused, and toolbar items morph across navigation.
- **Scroll edge effect.** The system drives it from the scroll position (GL-7); never add your own animated gradient or blur under bars. Small glass flipping between light and dark with the content underneath is a material behavior (liquid-glass.md §2), not something you animate.
- **Don't** put `.transition(.opacity)` on glass, animate blur radii, or animate neighboring pieces of glass separately when they should morph as one.
- **Reduce Motion.** The system removes elasticity. For your custom glass, keep the morph but drop the bounce (`.smooth`); large spatial moves become cross-fades (§12).

```swift
GlassEffectContainer(spacing: 20) {                       // shapes closer than 20 pt blend and morph
    HStack(spacing: 20) {
        Image(systemName: "pencil").frame(width: 44, height: 44)
            .glassEffect(.regular.interactive()).glassEffectID("pencil", in: ns)
        if expanded {                                     // grows out of the pencil (.matchedGeometry)
            Image(systemName: "eraser").frame(width: 44, height: 44)
                .glassEffect(.regular.interactive()).glassEffectID("eraser", in: ns)
        }
    }
}
.onTapGesture { withAnimation(reduceMotion ? .smooth : .snappy) { expanded.toggle() } }
```

## 7. SF Symbols animation

**MOT-10** Choose the effect for what it _means_, then its form for how long it lasts (HIG SF Symbols → Animations; WWDC23 "Animate symbols in your app"; WWDC25 "What's new in SF Symbols 7"). What each effect looks like is catalogued in foundations.md (SYM-1), API availability is in swiftui.md, and which effect confirms which outcome is FB-5.

| Meaning                                                         | Effect                                                                     | When and for how long                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **State change** between two symbols (play/pause, mute)         | Replace; Magic Replace is the default                                      | Once per change, as a content transition (UIKit buttons: the configuration's `symbolContentTransition`, 26) |
| **"It happened"** (sent, added)                                 | Bounce                                                                     | Once per event, keyed to a changing value                                                                   |
| **Look here** (an easily missed call to action, or a direction) | Wiggle                                                                     | Once, occasionally; never on a loop                                                                         |
| **Ongoing activity** (connecting, syncing, in progress)         | Pulse, Variable Color or Rotate; Breathe for live status such as recording | While the activity runs (`isActive:`); stop the moment it ends                                              |
| **Persistent emphasis** (selected)                              | Scale                                                                      | Until the emphasis ends                                                                                     |
| **Show or hide**                                                | Appear / Disappear; Draw On / Draw Off (7) for a handwritten stroke        | On insertion or removal, as a transition                                                                    |
| **Progress value**                                              | Variable Draw (7) or Variable Color                                        | Driven by the value, never by a timer                                                                       |
| **Completion**                                                  | Draw On of a checkmark, or Replace circle → `checkmark.circle.fill`        | Once, when the task ends                                                                                    |

- **Use effects sparingly.** A few meaningful animations beat many; match the app's tone, and never make an effect the only signal (MOT-1). Keep the default speed and repetition unless the meaning calls for more, and strip effects inherited from ancestors with `.symbolEffectsRemoved()`.
- **Reduce Motion.** Whether system symbol effects scale themselves down is (unverified), so gate repeating and attention effects (Wiggle, repeated Bounce, Breathe) yourself.

```swift
Image(systemName: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
    .contentTransition(.symbolEffect(.replace))
Image(systemName: "paperplane.fill").symbolEffect(.bounce, value: sentCount)
Image(systemName: "record.circle").symbolEffect(.breathe, isActive: isRecording && !reduceMotion)
if isDone { Image(systemName: "checkmark.circle").transition(.symbolEffect(.drawOn)) }
Image(systemName: symbolName, variableValue: progress).symbolVariableValueMode(.draw)   // Variable Draw
```

## 8. Content transitions

A content transition changes what's _inside_ a view without inserting or removing the view. It only takes effect inside an animation.

| Change                                 | Use                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbers: counters, prices, timers      | `.contentTransition(.numericText(value: x))` (17), which rolls digits in the direction of change. Add `.monospacedDigit()` so the width doesn't jitter. |
| Same string, new weight, size or color | `.interpolate`: glyphs morph within one font design, otherwise it falls back to opacity                                                                 |
| Arbitrary text swap                    | `.opacity`, or a quick cross-fade                                                                                                                       |
| Symbol swap                            | `.symbolEffect(.replace)` (§7)                                                                                                                          |
| No animation                           | `.identity`                                                                                                                                             |

```swift
Text(total, format: .currency(code: "USD"))
    .contentTransition(.numericText(value: total)).monospacedDigit()
// withAnimation { total += 5 }
```

On the web, use tabular figures (`font-variant-numeric: tabular-nums`) and a short cross-fade. Per-digit rolling is decoration; reserve it for hero numbers.

## 9. Scroll-linked motion

Scroll-linked effects are tied to _position_, not time, which makes them interruptible and 1:1 by construction.

- **`scrollTransition`** changes rows as they enter or leave the viewport. `.interactive` scrubs the effect with the scroll position; `.animated` fires once at a threshold. The `identity` phase (fully visible) must look unmodified, and in lazy stacks never move offscreen views into the visible rect.
- **`visualEffect { content, proxy in … }`** applies geometry-driven effects that don't affect layout (parallax, stretchy headers, depth); read `proxy.frame(in: .scrollView)`.
- **`onScrollGeometryChange(for:of:action:)`** turns scroll geometry into state. Convert it to a small Equatable value, such as a Bool for "collapsed", so the body only updates when that value changes. `onScrollPhaseChange` reports idle, tracking, interacting, decelerating and animating.
- **Paging.** `.scrollTargetBehavior(.paging)` pages by the container; `.viewAligned` with `.scrollTargetLayout()` snaps to items and limits a flick to a few items in compact width.
- **Large titles** are system-managed and live inside the scroll content. They scroll under the bar, the inline title appears, and it returns on scroll-to-top (HIG Toolbars). Don't rebuild this by hand natively.
- **Parallax is seasoning.** Keep it subtle, about 0.2–0.3× the scroll delta (heuristic). Remove it under Reduce Motion (MOT-5), and remove custom scroll effects for visionOS Look to Scroll. Custom scrolling must keep the elastic edge behavior people expect (HIG Scroll views).

```swift
Hero().frame(height: 280)
    .visualEffect { content, proxy in
        let y = proxy.frame(in: .scrollView).minY                      // > 0 while pulled down
        return content
            .scaleEffect(y > 0 ? 1 + y / 280 : 1, anchor: .bottom)       // stretchy header
            .offset(y: parallax && y < 0 ? -y * 0.3 : 0)               // let parallax = !reduceMotion
    }
Row().scrollTransition { content, phase in
    content.opacity(phase.isIdentity ? 1 : 0.4).scaleEffect(phase.isIdentity ? 1 : 0.96)
}
```

## 10. Gesture-driven motion

- **MOT-3** Track 1:1, then settle with the gesture's velocity. In SwiftUI, changes made in `DragGesture.onChanged` track velocity automatically (`Transaction.tracksVelocity`), and a spring started in `onEnded` inherits it with no extra work. In UIKit (iOS 18 and later), call `UIView.animate(.interactiveSpring)` on every `.changed` and `UIView.animate(.spring)` at `.ended`; each call retargets the last and velocity carries through. Before 18, pass a normalized `initialSpringVelocity`.
- **MOT-8** Decide with projection, not position. Estimate where the motion _would_ end (velocity × deceleration): SwiftUI gives you `predictedEndTranslation`; in UIKit, use `project()` below with `UIScrollView.DecelerationRate` (`.normal` 0.998 and `.fast` 0.99 per millisecond, both read at runtime). One test then covers both "dragged far enough" and "flicked fast". Snap to whichever end the _projected_ point is closest to: dismiss vs return, or the nearest corner for a picture-in-picture window.
- **Rubber-band at limits** instead of stopping dead, so people feel the edge. The widely used UIScrollView approximation is `f(x) = (1 − 1 / (x·c/d + 1))·d` with c = 0.55 and d = the view's dimension. It is community-derived, not an Apple API (unverified).
- **Scrubbing and reversal (UIKit).** With `UIViewPropertyAnimator`, call `pauseAnimation()` when the gesture begins and set `fractionComplete` to the gesture's progress 1:1. At the end, set `isReversed` from the projection's direction and call `startAnimation()`. `scrubsLinearly` (default `true`) keeps scrubbing linear, and `pausesOnCompletion` keeps a finished animator reversible.
- **Scripted motion.** `PhaseAnimator` sequences discrete steps, looping (ambient) or on a trigger (event). `KeyframeAnimator` runs independent per-property tracks (`Linear`, `Spring`, `Cubic`, `MoveKeyframe`). Keyframes are pre-scripted clips that can't retarget gracefully the way springs can: never use them for interactive or state-driven UI, and avoid changing them mid-flight.
- **Always provide an alternative.** Every gesture needs an on-screen alternative, such as a Close button for swipe-to-dismiss.

```swift
func rubberBand(_ x: CGFloat, dimension d: CGFloat, c: CGFloat = 0.55) -> CGFloat { (1 - 1 / (x * c / d + 1)) * d }
/// Distance travelled while decelerating from `velocity` (pt/s) — WWDC18 "Designing Fluid Interfaces".
func project(_ velocity: CGFloat, decelerationRate: UIScrollView.DecelerationRate = .normal) -> CGFloat {
    (velocity / 1000) * decelerationRate.rawValue / (1 - decelerationRate.rawValue)
}
// SwiftUI: 1:1 drag, rubber-band upward, projection decides, spring inherits the drag velocity.
.offset(y: offset)
.gesture(DragGesture()
    .onChanged { v in let dy = v.translation.height; offset = dy >= 0 ? dy : -rubberBand(-dy, dimension: 400) }
    .onEnded { v in
        if v.predictedEndTranslation.height > 200 { withAnimation(.smooth) { offset = 900 } completion: { onDismiss() } }
        else { withAnimation(.spring(duration: 0.5, bounce: 0.2)) { offset = 0 } }
    })
// UIKit .ended: let dismiss = offset + project(v) > h / 2; target = dismiss ? h : 0
UIView.animate(springDuration: 0.5, bounce: dismiss ? 0 : 0.2,
               initialSpringVelocity: target == offset ? 0 : v / (target - offset), options: [.allowUserInteraction]) {
    sheet.transform = CGAffineTransform(translationX: 0, y: target)
}
```

## 11. Loading and progress

- **Show something immediately.** Placeholders beat a blank screen, and the best loading finishes before people notice it (HIG Loading). Native: `.redacted(reason: .placeholder)` draws static placeholder shapes; widgets and similar can mark content stale with `.invalidatableContent()` plus the `.invalidated` redaction.
- **Shimmer is not a system idiom.** SwiftUI provides static placeholders, not shimmer (observed). If a skeleton must show activity, use a slow, low-contrast opacity pulse (in the spirit of the symbol Pulse effect) rather than a sweeping highlight, and stop it under Reduce Motion.
- **Prefer determinate progress** (HIG Progress indicators). Keep indicators moving, since a frozen one reads as a hang, and pace progress honestly. Switch from indeterminate to determinate as soon as you know the duration, but never swap a spinner for a bar, since their shapes differ. Let people cancel.
- **MOT-13** Spinner timing. For waits that are usually short, delay the spinner by about 300–500 ms so fast loads don't flash, and once it's visible keep it about 500 ms (heuristic). Indicators keep moving under Reduce Motion (MOT-5). On watchOS avoid indicators where you can; a second or two of spinner still beats a blank screen. A spinner _inside a busy button_ is a feedback state (FB-7, interaction-feedback.md §8); on the web it embeds the same `.activity-indicator`.
- **Pull to refresh.** Native `.refreshable { await … }` gives the standard control, which tracks the pull 1:1 and stays while the task runs; macOS 27 adds `NSRefreshController`. Also refresh automatically so people don't have to pull. A title is optional and should add information, such as when the content last updated.

```swift
List(model.items) { ItemRow($0) }
    .redacted(reason: model.isLoading && model.items.isEmpty ? .placeholder : [])
    .refreshable { await model.reload() }
    .overlay { if showSpinner { ProgressView() } }
    .task(id: model.isLoading) {
        showSpinner = false
        guard model.isLoading else { return }
        try? await Task.sleep(for: .milliseconds(400))       // no flash for fast loads
        if !Task.isCancelled { showSpinner = true }
    }
```

## 12. Reduce Motion and related settings

**MOT-5** Substitute rather than delete. When Reduce Motion is on, the HIG asks you to cut automatic and repeating animation, including zooming, scaling and peripheral motion, but people still need to see what changed:

| Instead of                                                    | Do                                             |
| ------------------------------------------------------------- | ---------------------------------------------- |
| Slides and pushes along x, y or z; zoom and scale transitions | Cross-fade in about 0.2–0.25 s (heuristic)     |
| Bouncy springs                                                | Bounce 0 (`.smooth`), same pace                |
| Depth (z-axis) animation, parallax, peripheral motion         | None; content moves only with the scroll       |
| Animating into or out of blur (`.blurReplace`)                | `.opacity`                                     |
| Looping or attention effects (Wiggle, Breathe, ambient loops) | Static, or one iteration                       |
| Gesture-driven motion                                         | Keep tracking 1:1; settle without bounce       |
| Essential feedback: spinners, progress, state changes, focus  | Keep it (HIG: keep progress indicators moving) |

| Setting                                                       | SwiftUI                                                                                                                 | UIKit / other                                                                                     | Web                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Reduce Motion                                                 | `accessibilityReduceMotion`                                                                                             | `UIAccessibility.isReduceMotionEnabled` + `reduceMotionStatusDidChangeNotification`               | `@media (prefers-reduced-motion: reduce)`                                            |
| Prefer Cross-Fade Transitions (a sub-option of Reduce Motion) | `accessibilityPrefersCrossFadeTransitions` (26.4); on macOS it just reports Reduce Motion, on watchOS it's always false | `UIAccessibility.prefersCrossFadeTransitions` (14) + `prefersCrossFadeTransitionsStatusDidChange` | none (use reduced-motion)                                                            |
| Auto-Play Animated Images                                     | `accessibilityPlayAnimatedImages` (17)                                                                                  | `AccessibilitySettings.animatedImagesEnabled` + change notification (Accessibility framework)     | none: provide pause controls; don't autoplay GIF or APNG heroes under reduced motion |
| Auto-Play Video Previews                                      | —                                                                                                                       | `UIAccessibility.isVideoAutoplayEnabled`                                                          | none                                                                                 |
| Dim Flashing Lights                                           | `accessibilityDimFlashingLights` (17)                                                                                   | `MADimFlashingLightsEnabled()` (MediaAccessibility)                                               | none: never strobe                                                                   |
| Reduce Bright Effects                                         | `accessibilityReduceHighlightingEffects` (26.4): minimize highlight and flash on controls (interaction-feedback.md §9)  | —                                                                                                 | —                                                                                    |

```swift
@Environment(\.accessibilityReduceMotion) private var reduceMotion
Text("Saved")
    .transition(reduceMotion ? AnyTransition.opacity : .move(edge: .top).combined(with: .opacity))
    // on the container: .animation(reduceMotion ? .easeInOut(duration: 0.2) : .snappy, value: visible)
```

## 13. Platform notes

- **iOS and iPadOS.** Touch gets the most expressive glass response. On iPad, remember pointer hover (`hoverEffect(.lift)`; interaction-feedback.md §7), resizable windows (animate size changes, don't snap) and inactive-window dimming. Keep controls reachable; one-handed swipe gestures such as back-swipe matter.
- **macOS: restraint.** The response to a trackpad or mouse is more subdued than to touch, and glass bounce on click (new in 27) is for interactive glass only. Windows and sheets use system motion. Keep app transitions short, avoid bouncy springs on large surfaces, keep state changes crisp, and make keyboard-driven changes instant or cross-faded (heuristic).
- **watchOS.** Motion anchors to the Digital Crown, which scrolls pages and lists and turns values with haptic detents (`digitalCrownRotation(_:from:through:by:sensitivity:isContinuous:isHapticFeedbackEnabled:)`). Keep interactions glanceable. WatchKit animations have built-in easing you can't change; SwiftUI gives full control.
- **MOT-14** visionOS: comfort first. No motion in the periphery, and keep a stationary frame of reference. Avoid sustained oscillation, especially near 0.2 Hz. Fade objects out and back in to relocate them, and don't rotate the world (use an instant change during a quick fade). For large moving objects, raise translucency or lower contrast, and slow down dark-to-bright transitions.
- **tvOS: focus _is_ the motion.** A focused item lifts: it scales up, gains a shadow and illumination, and shows parallax depth (it tilts slightly as the finger moves on the remote (observed)). Use `.buttonStyle(.card)` or system focusable views, and supply artwork large enough for the focused scale. Standard buttons and controls take on Liquid Glass when focused.

## 14. Web recipes

**Kit files.** Motion tokens live in `assets/css/tokens.css`, the motion classes in `assets/css/blocks/motion.css`, and `AppleMotion` in `assets/js/apple-interactions.js`: an ES module whose named export is also set on `globalThis`. Build only what the page uses (tokens always come first):

```sh
python3 scripts/build_kit.py motion sheet tabbar --minify --css app.css --js app.js   # app.js: classic script, globalThis.AppleMotion
```

In a module, use `import { AppleMotion } from "./apple-interactions.js"` instead. For a single-file deliverable, leave empty `<style data-kit>` and `<script data-kit>` tags in the page and let `build_kit.py … --minify --inline index.html` fill them as the last step (web.md §1); copy single functions only on the no-Python path. Don't paste block CSS into answers (WEB-1); glass rendering cost is WEB-3.

**14.1 Springs from tokens.** Pair each spring easing with its own duration token (§3), and use a shorter `--dur-*` for a faster pace with the same character. The kit's blocks follow the §4 pairs: `.sheet` slides on `var(--dur-spring-smooth)` + `var(--spring-smooth)`; thumbs and selection indicators slide on the snappy pair, so a tab selection moves (`.tabbar__indicator`) instead of fading; presses go in on `var(--dur-press)` + `var(--curve-out)` and spring back on the snappy pair (MOT-11). Animate only `transform`, `translate`, `scale`, `rotate` and `opacity` (MOT-6).

```css
.tabbar__indicator {
  transition: transform var(--dur-spring-snappy) var(--spring-snappy);
} /* = .snappy */
```

```js
// Custom spring or initial velocity via the WAAPI (compositor-driven):
const { easing, duration } = AppleMotion.springEasing({ duration: 0.35, bounce: 0.1 });
el.animate({ translate: ['0 24px', '0 0'], opacity: [0, 1] }, { duration, easing });
```

**14.2 Morph from the source with View Transitions** (same-document: Chrome 111, Safari 18, Firefox 144). `AppleMotion.morph()` names `from` and then `to` as `motion-morph`, so the browser animates one box into the other (a thumbnail into a detail view, or a button into a menu) with the smooth spring. Under reduced motion it names nothing, and you get the default whole-page cross-fade of 0.25 s. Per the spec, the group also carries `backdrop-filter`, so glass keeps blurring during the morph; browser coverage of this is (unverified). The fallback is `AppleMotion.flip(el, mutate)`, a FLIP animation with a spring easing.

```js
AppleMotion.morph(() => openDetail(item), { from: thumb, to: () => detailHero });
```

```css
::view-transition-group(motion-morph) {
  animation-duration: var(--dur-spring-smooth);
  animation-timing-function: var(--spring-smooth);
}
```

**14.3 Enter and exit for popovers, dialogs and menus.** `.motion-pop` fades in, scales from 0.9 around `--motion-origin` and settles on the snappy spring, then exits faster in `--dur-fast`. It uses `@starting-style` (Chrome 117, Safari 17.5, Firefox 129) and `transition-behavior: allow-discrete` on `display` and `overlay`, so the exit can animate too. Only Chromium supports `overlay`, which keeps the element in the top layer during its exit; other engines still fade it but it may drop below other layers. It works with `[popover]`, `<dialog>` and elements toggled with `.is-open`. `.motion-fade` is the same without the scale, and under reduced motion `.motion-pop` fades only.

```html
<button class="btn-glass" popovertarget="more" aria-label="More">…</button>
<div id="more" popover class="glass motion-pop" style="--motion-origin: top right">…</div>
```

```css
/* core of the pattern; the full rule set is in assets/css/blocks/motion.css (build it, don't paste it) */
.motion-pop {
  opacity: 0;
  scale: 0.9;
  transform-origin: var(--motion-origin, center);
  transition:
    opacity var(--dur-fast) var(--curve-standard),
    scale var(--dur-fast) var(--curve-standard),
    display var(--dur-fast) allow-discrete,
    overlay var(--dur-fast) allow-discrete;
}
.motion-pop:popover-open {
  opacity: 1;
  scale: 1;
  transition:
    opacity var(--dur-fast) var(--curve-standard),
    scale var(--dur-spring-snappy) var(--spring-snappy);
}
@starting-style {
  .motion-pop:popover-open {
    opacity: 0;
    scale: 0.9;
  }
}
```

**14.4 Large-title collapse with scroll-driven animations** (Chrome 115, Safari 26; Firefox has none yet). The large title is ordinary content that scrolls away, while the inline toolbar title fades in over `--motion-range`, tied to scroll position (the kit's `scroll-edge` block reveals itself over the first 24 px of scrolling and stays hidden when nothing scrolls). Put `.motion-scroll-root` on the common ancestor (it sets `timeline-scope`) and `.motion-scroller` on the scroll container. If the document itself scrolls, put `.motion-scroller` on `<html>` and skip the root class. Where scroll-driven animations aren't supported, the fallback is a class toggle. (The kit's `navbar` block packages the large-to-inline title.)

```html
<div class="motion-scroll-root">
  <header class="toolbar">
    <span class="t-headline motion-reveal-on-scroll" style="--motion-range: 40px 72px"
      >Library</span
    >
  </header>
  <main class="motion-scroller">
    <h1 class="t-large-title">Library</h1>
    …
  </main>
</div>
```

```js
// fallback, only when !CSS.supports("animation-timeline: scroll()")
scroller.addEventListener(
  'scroll',
  () => root.classList.toggle('is-scrolled', scroller.scrollTop > 40),
  { passive: true },
);
```

**14.5 Drag, then settle with velocity** (a sheet, card or drawer). The recipe tracks 1:1, rubber-bands past the limit, lets the projection decide, and hands the release velocity to the spring. Grabbing the element mid-flight stops the spring where it is.

```js
const { animateSpring, rubberBand, project, VelocityTracker, reducedMotion } = AppleMotion;
let y = 0,
  grabY = 0,
  anim,
  vt; // handle: e.g. .sheet__grabber (hit area per HIT-1), touch-action: none
handle.addEventListener('pointerdown', (e) => {
  anim?.stop();
  vt = new VelocityTracker();
  grabY = e.clientY - y;
  handle.setPointerCapture(e.pointerId);
});
handle.addEventListener('pointermove', (e) => {
  if (!vt) return;
  const raw = e.clientY - grabY;
  y = raw >= 0 ? raw : -rubberBand(-raw, sheet.offsetHeight); // resist upward
  vt.add(y, e.timeStamp);
  sheet.style.translate = `0 ${y}px`;
});
const release = () => {
  if (!vt) return;
  const v = vt.velocity();
  vt = null; // px/s over the last ~100 ms
  const dismiss = y + project(v) > sheet.offsetHeight / 2; // distance OR flick
  anim = animateSpring(y, dismiss ? sheet.offsetHeight : 0, {
    velocity: v,
    bounce: dismiss || reducedMotion() ? 0 : 0.2,
    onUpdate: (p) => {
      y = p;
      sheet.style.translate = `0 ${p}px`;
    },
    onDone: () => {
      if (!dismiss) return;
      sheet.style.transition = 'none';
      closeSheet(); // already off-screen: don't replay the CSS exit
      sheet.style.translate = '';
      y = 0;
      sheet.offsetHeight; // commit, then restore transitions
      sheet.style.transition = '';
    },
  });
};
handle.addEventListener('pointerup', release);
handle.addEventListener('pointercancel', release);
```

**14.6 Performance.**

- **MOT-6** Animate only compositor properties: `transform` (or its individual `translate`, `scale` and `rotate`) and `opacity`. Never animate `backdrop-filter` or `filter: blur()` radii, `width`, `height`, `top`, `left`, or big shadows on glass. Move layout with FLIP (`AppleMotion.flip`) or View Transitions instead.
- **Don't fade a glass ancestor.** Per the Filter Effects spec, an ancestor with `opacity` below 1, a `filter`, a mask or clip-path, or `will-change` naming one of them becomes a backdrop root (a transform doesn't), so glass inside it blurs only that ancestor's content until the effect ends. Put `.motion-pop` or `.motion-fade` on the glass surface itself, and set `will-change` only while a gesture runs. Surface ceiling: GL-3.
- **Keep the JS path light.** In rAF springs, write styles once per frame and don't read layout in the loop. Use passive scroll listeners and `touch-action` on drag handles. Pause loops off-screen.

**14.7 Reduced motion on the web** (MOT-5). Each kit block carries its own `prefers-reduced-motion` substitutes next to its rules, so no component can be missing from a central list. Springs lose their bounce (`--spring-snappy` and `--spring-bouncy` resolve to the smooth curve), `--press-scale` becomes 1 (presses keep their fill), `.motion-pop` only fades, `.sheet` and its backdrop cross-fade instead of sliding, thumbs and `.tabbar__indicator` move without sliding, staggers drop to 0, and `morph()` falls back to the page cross-fade. `base.css` stops decorative `@keyframes` animations (never transitions, which carry the fades), and `motion.css` exempts `.activity-indicator`, because status must keep moving. Give your own components the same treatment next to their rules, from the §12 table. In JS, check `AppleMotion.reducedMotion()` before starting motion, but keep 1:1 drag tracking and spinners. The web has no equivalent of Prefer Cross-Fade Transitions or Auto-Play Animated Images, so treat `prefers-reduced-motion` as covering both and give autoplaying media pause controls.

## 15. Anti-patterns

1. **Long or decorative animation:** anything that makes people wait, especially on something they do often, or motion that exists "to look modern" (MOT-1).
2. **`ease-in-out` on everything, or linear motion:** velocity jumps at start and end, no velocity handoff, additive pile-ups when interrupted. Use springs; save `--curve-standard` for opacity and color (MOT-2).
3. **Animating layout properties** (`width`, `height`, `top`, `left`, `margin`) or blur radii. Animate transforms, or use FLIP (MOT-6).
4. **Bouncing every state change.** Bounce is for momentum and a few playful moments; plain toggles and taps get no visible bounce (MOT-7).
5. **Motion as the only signal:** a wiggle or pulse with no text, haptic or state change behind it (MOT-1).
6. **Parallax, auto-scrolling carousels or peripheral motion for their own sake**, especially in visionOS or with Reduce Motion on (MOT-5, MOT-14).
7. **Fading glass instead of materializing or morphing it**, animating glass pieces separately when they should merge, or glass that pops in without a source (MOT-9).
8. **Blocking input during transitions:** ignoring taps while animating, or animations that can't be grabbed or reversed (MOT-3).
9. **Lost continuity:** things that exit in a different direction from where they came in, or modal views that appear from nowhere instead of from their source (MOT-4).
10. **Deleting all motion under Reduce Motion:** frozen spinners, no state feedback, or bouncy springs left on (MOT-5).
11. **Keyframed or timeline-scripted UI state:** it can't retarget and feels canned. Keep keyframes for celebrations and ambient loops (MOT-3).
12. **A late press or a fading selection:** a pressed state that eases in on a slow spring, or a tab or segment selection that fades instead of sliding (MOT-11, MOT-4).
13. **Flashing or frozen spinners:** an indicator that blinks on fast loads, or one that stops moving (MOT-13).

## 16. Sources

**Apple HIG** (JSON at `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`)

- Motion (changelog Sep 9 2025): https://developer.apple.com/design/human-interface-guidelines/motion · Accessibility (motion section): https://developer.apple.com/design/human-interface-guidelines/accessibility
- SF Symbols (Animations, changelog Jul 28 2025): https://developer.apple.com/design/human-interface-guidelines/sf-symbols
- Loading · Progress indicators: https://developer.apple.com/design/human-interface-guidelines/loading · https://developer.apple.com/design/human-interface-guidelines/progress-indicators
- Sibling pages under /design/human-interface-guidelines/: Tab bars, Toolbars, Sheets, Popovers, Scroll views, Materials, Gestures, Focus and selection, Digital Crown, Designing for visionOS / macOS / watchOS / tvOS

**Apple WWDC sessions** (https://developer.apple.com/videos/play/wwdcYYYY/ID/)

- WWDC18 803, Designing Fluid Interfaces: https://developer.apple.com/videos/play/wwdc2018/803/
- WWDC23: 10158 Animate with springs · 10156 Explore SwiftUI animation · 10157 Wind your way through advanced animations in SwiftUI · 10258 Animate symbols in your app · 10078 Design considerations for vision and motion
- WWDC24: 10145 Enhance your UI animations and transitions · 10151 Create custom visual effects with SwiftUI · 10188 What's new in SF Symbols 6
- WWDC25: 219 Meet Liquid Glass · 356 Get to know the new design system · 323 Build a SwiftUI app with the new design · 284 Build a UIKit app with the new design · 337 What's new in SF Symbols 7 · 256 What's new in SwiftUI · 243 What's new in UIKit
- WWDC26: 269 What's new in SwiftUI · 278 Modernize your UIKit app · 289 Modernize your AppKit app · 250 Principles of great design · 251 Communicate your brand identity on iOS · 102 Platforms State of the Union

**Apple API docs** (https://developer.apple.com/documentation/…; JSON under /tutorials/data/documentation/…)

- SwiftUI animation: `Spring`, `Animation` (`smooth`/`snappy`/`bouncy`/`default`/`spring(response:dampingFraction:blendDuration:)`/`interactiveSpring`), `withAnimation(_:completionCriteria:_:completion:)`, `Transaction.tracksVelocity`, `PhaseAnimator`, `KeyframeAnimator`, `ContentTransition`, `Transition`
- SwiftUI navigation and glass: `navigationTransition(_:)`, `NavigationTransition.crossFade` (27), `AnyNavigationTransition` (27), `matchedTransitionSource`, `toolbarMinimizationBehavior(_:for:)` (27), `TabBarMinimizeBehavior`, `GlassEffectContainer`, `glassEffectID`, `glassEffectTransition`, `GlassEffectTransition`, "Applying Liquid Glass to custom views"
- SwiftUI scroll, gesture, symbols, loading and accessibility: `scrollTransition`, `visualEffect`, `onScrollGeometryChange`, `scrollTargetBehavior`, `DragGesture.Value.predictedEndTranslation`, `symbolEffect(_:options:value:)`, `symbolEffect(_:options:isActive:)`, `symbolEffectsRemoved(_:)`, Symbols framework (`DrawOnSymbolEffect`, `ReplaceSymbolEffect`, `SymbolEffectOptions`), `symbolVariableValueMode(_:)`, `redacted(reason:)`, `refreshable(action:)`, accessibility environment values
- UIKit, Core Animation, AppKit: `UIView.animate(springDuration:bounce:initialSpringVelocity:delay:options:animations:completion:)`, `UIView.animate(_:changes:completion:)`, `UISpringTimingParameters`, `CASpringAnimation`, `UIScrollView.DecelerationRate`, `UIViewPropertyAnimator`, `UINavigationController.interactiveContentPopGestureRecognizer`, `UINavigationItem.navigationBarMinimization` (27), `UIViewController.Transition.zoom(options:sourceViewProvider:)`, `UIButton.Configuration.symbolContentTransition` (26), `UIAccessibility.prefersCrossFadeTransitions`, `NSGlassEffectView.effectIsInteractive` (27)
- Accessibility: Animated images (Accessibility framework) · Flashing lights (MediaAccessibility)
- SwiftUI updates (June 2026 "Transitions", "Toolbars"): https://developer.apple.com/documentation/updates/swiftui · SF Symbols: https://developer.apple.com/sf-symbols/

**Verification for this file.** Spring presets, formulas, samples and the stiffness/damping values were read from SwiftUI's `Spring` on macOS 26, and `UIScrollView.DecelerationRate` values and system defaults were read at runtime via Mac Catalyst. Swift snippets typecheck against the iOS 26.2, tvOS and watchOS SDKs, except the iOS 26.4 and 27 APIs, which are verified on their documentation pages only. The press-in timing (MOT-11) comes from a measured web-kit tap (Chrome, DevTools Protocol). The web snippets and tokens were exercised in headless Chrome 154, with and without reduced motion.

**Web**

- MDN: `linear()` https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear · View Transition API https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API · `@starting-style` https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style · `transition-behavior` https://developer.mozilla.org/en-US/docs/Web/CSS/transition-behavior · `overlay` https://developer.mozilla.org/en-US/docs/Web/CSS/overlay
- MDN: Scroll-driven animations https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations · `animation-range-start` (declare it after the `animation` shorthand) https://developer.mozilla.org/en-US/docs/Web/CSS/animation-range-start · `prefers-reduced-motion` https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- CSS View Transitions Level 1 (UA stylesheet: 0.25 s default; the group carries `backdrop-filter`): https://drafts.csswg.org/css-view-transitions-1/ · Filter Effects Level 2, Backdrop Root: https://drafts.csswg.org/filter-effects-2/#BackdropRoot
- Browser versions: @mdn/browser-compat-data 8.1.3 (2026-09-24). Rubber-band formula (community reverse-engineering): https://gist.github.com/originell/6961057
