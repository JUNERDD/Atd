# Apple Design Review Checklist

Two tools: a **quick self-review** to run on your own output before handing it back, and a **full audit rubric** for when the user asks for a review. Every item names the rule it enforces (see the owner file's "Rules at a glance") and how to verify it. Measure instead of eyeballing wherever a number exists.

When reporting a review, rank findings by impact — hierarchy and usability first, polish last — and write each as **what's wrong → the principle in plain words (and its Apple guideline) → concrete fix**. Then give the corrected version if asked. The rule IDs below are for your own lookup; don't put them in the answer, since the person can't look them up.

## Quick self-review (builders: all 15, every time)

1. **Glass only on the functional layer**, none on content, none nested, within budget — list every glass/backdrop-filter element and count them. (GL-1, GL-2, GL-3)
2. **Standard navigation model and one primary action per screen.** (CMP-1, CMP-2)
3. **In-content buttons are opaque** (bordered/filled); glass buttons only float. (CMP-3)
4. **System font + text styles**; iOS Body 17 (macOS 13); bold left-aligned titles; no ALL-CAPS headers. (TYP-1, TYP-2)
5. **Semantic colors, one accent, label color chosen per fill** — `scripts/contrast.py --on <fill>`. (COL-1, COL-2, COL-3)
6. **Risky contrast pairs measured** in light, dark and Increase Contrast: text on glass over its worst backdrop, label on accent fill, glyph on tinted tile, secondary/link text on grouped background. (CON-1, CON-2)
7. **Every hit box ≥ 44×44 pt, measured** — including segments, grabbers, stepper halves, close/clear buttons; spacing between controls. Recreated controls use the measured OS 26 metrics, not the old 51×31 switch or 44-pt rows. (HIT-1, HIT-2, CMP-8, CMP-10)
8. **Safe areas and system margins**; content runs under bars. (LAY-1, LAY-2)
9. **Capsules and concentric radii** (inner = outer − padding). (GL-6)
10. **States designed**: pressed on touch-down, hover only for fine pointers, visible focus, selected, disabled-and-explained. (FB-1, FB-2, FB-3, FB-6)
11. **Motion explains**: springs, interruptible, morphs from its source; Reduce Motion substitutes fades instead of deleting feedback. (MOT-1…MOT-5)
12. **Outcomes confirmed in place**: success via symbol/inline change, errors inline, busy state inside the control, undo over confirmation, no toasts by default. (FB-5, FB-7)
13. **Haptics (native)**: semantic type, one per meaningful outcome, none stacked on system controls. (FB-4)
14. **Web only**: lean output (only the kit blocks you use, built with `scripts/build_kit.py`), animations on transform/opacity only, glass legible without `prefers-reduced-transparency`. (WEB-1, WEB-2, WEB-3, MOT-6)
15. **Appearance and language**: follows the system light/dark setting (no app theme toggle; a web override only when the user or product requires one, and only in settings), localized layout (CJK without SF tracking, RTL via logical properties). (COL-4, WEB-6, LOC-1)

## Full audit rubric

### 1. Hierarchy and material (highest impact)

| Check                                                                 | Rule        | How to verify                                                                                                |
| --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Content opaque; glass only on bars, controls, sheets, menus, popovers | GL-1        | List every glass element; each must be navigational or actionable                                            |
| No glass inside glass; neighbours grouped                             | GL-2        | Inspect nesting (web: ancestors with `backdrop-filter`; native: glass inside `GlassEffectContainer` members) |
| Glass budget respected                                                | GL-3        | Count at rest and fully scrolled; web ≤ 6 backdrop-filter surfaces                                           |
| Regular vs clear used correctly; clear has dimming                    | GL-4        | Clear only over media; check label contrast with `contrast.py --over`                                        |
| Only the single primary action is tinted                              | GL-5, CMP-2 | Count tinted/prominent controls per view or region                                                           |
| Scroll edge effect instead of custom bar backgrounds/dividers         | GL-7        | No custom opaque/blurred bar fills; native: no `.toolbarBackground` hacks                                    |
| Material ladder respected; cards opaque; brand color in content       | GL-8, GL-10 | Content cards use grouped fills, not glass or materials                                                      |
| Nothing collides with glass at rest                                   | GL-11       | Screenshot at first launch and at scroll top                                                                 |

### 2. Navigation and structure

| Check                                                                                                                                                 | Rule         | How to verify                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------- |
| Tab bar navigates (≤ 5 destinations on iPhone), toolbars act; iPad: top tab bar, sidebar-adaptable; Mac: sidebar                                      | CMP-1        | Map every bar item to "go somewhere" or "do something"                |
| Toolbars ≤ 3 groups; no text + symbol mixed in one capsule                                                                                            | CMP-4        | Inspect groups                                                        |
| Sheets morph from their source; grabber; Cancel leading / Done trailing                                                                               | CMP-5, MOT-4 | Open and close each sheet; watch where it comes from and goes back to |
| Search placed per platform                                                                                                                            | CMP-6        | iPhone bottom / search tab; iPad and Mac trailing                     |
| Presentation chosen by intent (sheet, popover, alert, dialog, menu, cover); one at a time; alerts only for problems                                   | CMP-9        | List every modal and why it interrupts                                |
| Requests late and in context; system experiences for system jobs; empty states explain; honest permission priming; launch screen mirrors first screen | PAT-2…PAT-6  | Walk first launch, sign-in, permissions and an empty account          |

### 3. Typography and writing

| Check                                                                            | Rule  | How to verify                                                                      |
| -------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------- |
| System font; text styles; Dynamic Type/200 % scaling reflows                     | TYP-1 | Largest accessibility size (native) or 200 % zoom (web) — no truncation or overlap |
| Hierarchy by weight/size; bold left-aligned titles; section headers not ALL CAPS | TYP-2 | Visual scan of headings                                                            |
| Consistent voice and capitalization; alert title style                           | WRI-1 | Read every label, button, alert                                                    |
| Localization: CJK without SF tracking, full-width punctuation, RTL mirrored      | LOC-1 | Switch `lang`/`dir` (web) or pseudolanguages/RTL (native)                          |

### 4. Color and contrast

| Check                                                                                                                                    | Rule         | How to verify                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| Semantic colors with light, dark and increased-contrast variants                                                                         | COL-1        | Toggle all three appearances                                                                          |
| One accent; meaning never by color alone                                                                                                 | COL-2        | Grayscale screenshot still readable                                                                   |
| Label/glyph color chosen per fill                                                                                                        | COL-3        | `contrast.py --on <fill>` for every tinted fill and tile                                              |
| Follows system appearance; no in-app theme toggle; a web override exists only when required, lives in settings and defaults to Automatic | COL-4, WEB-6 | Search for theme switches in bars and settings                                                        |
| Text ≥ 4.5:1 (≥ 3:1 at 18 pt/bold; web: WCAG large text only), glyphs ≥ 3:1; secondary labels only supplementary                         | CON-1        | `contrast.py FG BG --size N [--bold]` (native); add `--wcag` for web text (N in px)                   |
| Risky pairs checked in light/dark/IC                                                                                                     | CON-2        | Text on glass over worst backdrop (`--over`), label on accent fill, glyph on tile, link on grouped bg |

### 5. Layout, geometry and touch

| Check                                                              | Rule          | How to verify                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout by size class/window width; safe areas; content under bars  | LAY-1         | Resize: compact, regular, landscape; notch and home indicator                                                                                                                                                                                                                                                            |
| System margins 16/20 pt                                            | LAY-2         | Measure leading edges against bars and lists                                                                                                                                                                                                                                                                             |
| Every hit region ≥ 44×44 pt (platform values) including extensions | HIT-1, CMP-8  | Web: `getBoundingClientRect()` gives the border box only (pseudo-elements have no box), so run `hits(el)` from interaction-feedback.md §9 (FB-11) on each small control; native: Accessibility Inspector, or `.border(.red)` after `.contentShape`; list segments, grabbers, stepper halves and clear buttons explicitly |
| Spacing around controls                                            | HIT-2         | ~12 pt bezeled, ~24 pt borderless                                                                                                                                                                                                                                                                                        |
| Capsules / concentric radii                                        | GL-6          | inner radius = outer − padding                                                                                                                                                                                                                                                                                           |
| iOS 26 list and control metrics                                    | CMP-7, CMP-10 | ≈53-pt rows, 20-pt inset, 26-pt radius, 17-pt semibold headers; 63×28 switch with pill knob; 31–32-pt segments                                                                                                                                                                                                           |

### 6. Controls and states

| Check                                                                             | Rule  | How to verify                                                                |
| --------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| Highlight on touch-down, act on release inside, cancel on drag-off                | FB-1  | Press, drag off, release — nothing fires                                     |
| Hover only on fine pointers; nothing essential behind hover                       | FB-2  | Web: rules inside `@media (hover: hover) and (pointer: fine)`; test on touch |
| Pressed, focused, selected, disabled for every custom control; disabled explained | FB-3  | State matrix per control                                                     |
| Visible focus (keyboard, remote, gaze)                                            | FB-6  | Tab through everything; ring ≥ 3:1 and not clipped                           |
| In-content buttons opaque; glass buttons float                                    | CMP-3 | Inspect buttons inside cards/sheets                                          |

### 7. Motion

| Check                                                                                                                | Rule          | How to verify                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| Motion explains state/relationship; brief; not on frequent actions                                                   | MOT-1         | List every animation and its purpose                                                                            |
| Springs by default; no visible bounce on taps, state changes or presentations; 0.15–0.2 only after momentum gestures | MOT-2, MOT-7  | Native: `.smooth/.snappy/.bouncy` or `Spring(duration:bounce:)`; web: `--spring-*` paired with `--dur-spring-*` |
| Interruptible; 1:1 tracking; velocity handoff; released gestures decided by projected end point                      | MOT-3, MOT-8  | Grab mid-animation; flick short and fast, drag long and slow                                                    |
| Press in fast, release on a spring                                                                                   | MOT-11        | Tap quickly: the pressed look must land within ~100 ms                                                          |
| One primary motion per moment; stagger ≤ 150 ms total; glass morphs, never fades                                     | MOT-12, MOT-9 | Watch each transition; list every simultaneous animation                                                        |
| Loading: placeholders at once, spinner after ~300–500 ms, never frozen                                               | MOT-13        | Throttle the network                                                                                            |
| Morph from source; leave the way you came                                                                            | MOT-4         | Open/close pairs                                                                                                |
| Reduce Motion substitutes fades; essential progress keeps animating                                                  | MOT-5         | Enable Reduce Motion / `prefers-reduced-motion`                                                                 |
| Web animates transform/opacity only; never blur                                                                      | MOT-6         | Inspect transitions/keyframes                                                                                   |

### 8. Feedback, haptics and outcomes

| Check                                                                                               | Rule  | How to verify                                                            |
| --------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| Haptics semantic, one per meaningful outcome, not stacked on system controls, never the only signal | FB-4  | List each haptic trigger and its meaning                                 |
| Success confirmed in place; errors inline; prefer undo; no toasts by default                        | FB-5  | Walk the main task, including a failure                                  |
| Busy state inside the control; no double submit; spinners delayed                                   | FB-7  | Throttle the network                                                     |
| Accessible equivalents (value, traits, announcements) for every state change                        | FB-10 | VoiceOver / screen reader pass                                           |
| No second press effect, haptic or sound on top of a system control                                  | FB-8  | Compare each custom feedback with what the standard control already does |
| Undo preferred; confirmations only for uncommon or irreversible loss, anchored to their source      | FB-9  | Trigger each destructive action                                          |

### 9. Accessibility settings

| Check                                                                 | Rule                | How to verify                                                                        |
| --------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| Glass adapts to Reduce Transparency, Increase Contrast, the 27 slider | GL-9                | Toggle each; web: glass legible even without `prefers-reduced-transparency` (Safari) |
| Reduce Motion, Increase Contrast, Bold Text, larger text all handled  | MOT-5, CON-2, TYP-1 | Toggle each setting                                                                  |
| Forced colors (web) keep every state visible                          | WEB-4               | Emulate `forced-colors: active`                                                      |

### 10. System experiences (widgets, Live Activities, notifications, controls)

| Check                                                                | Rule         | How to verify                           |
| -------------------------------------------------------------------- | ------------ | --------------------------------------- |
| No custom glass/blur/outer card; background via the system container | SYS-1, SYS-2 | Inspect widget/Live Activity views      |
| Works in full color, accented and vibrant modes                      | SYS-3        | Preview each rendering mode             |
| Every Live Activity presentation shipped and consistent              | SYS-10       | Compact, minimal, expanded, Lock Screen |

### 11. Implementation hygiene

| Check                                                                                                                                                                                                | Rule                        | How to verify                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| Native: standard components; no custom bars/blur hacks; glass modifiers after layout; exact availability gates                                                                                       | NAT-1…NAT-4                 | Read the view code; typecheck                                                                     |
| Native: floating controls via `.safeAreaBar` (not overlays); `.snappy` for taps and a fade (never `nil`) under Reduce Motion; no hard-coded colors, fonts or metrics; icon-only controls keep labels | NAT-5, NAT-7, NAT-8, NAT-11 | Search for `.overlay`, `.bouncy`, `nil` animations, `.font(.system(size:`, `Color.white` on tints |
| Web: only needed blocks built (app shell ≲ 10 KB gzipped); kit spliced in, not pasted by hand; layered for Tailwind; keyboard parity; no Apple logos                                                 | WEB-1, WEB-3, WEB-4         | `python3 scripts/build_kit.py --size <blocks>`; keyboard-only pass                                |
| No Apple logos/trademarks as branding (Sign in with Apple button excepted)                                                                                                                           | —                           | Visual scan                                                                                       |
