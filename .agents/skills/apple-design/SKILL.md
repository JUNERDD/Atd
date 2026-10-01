---
name: apple-design
description: Apple-platform interface design in the current Liquid Glass language and Human Interface Guidelines (iOS, iPadOS, macOS, watchOS, tvOS, visionOS 26–27) — designing, building, animating and reviewing UIs so they look, move and respond like first-party Apple software, natively in SwiftUI, UIKit or AppKit or recreated on the web and in cross-platform frameworks. Covers layout, material, type, color and contrast, motion, touch and haptic feedback, accessibility, widgets and Live Activities, and design specs. Use it whenever the intent behind a request is an interface that should feel native to Apple platforms or follow their conventions. Judge that intent from what the person is trying to achieve, in any language or wording, even when Apple, iOS or Liquid Glass is never named, for example when an iPhone, iPad or Mac app's UI is being built, changed or judged. Skip it when no interface design is involved or a different design language is wanted.
---

# Apple Design (Liquid Glass era)

Build interfaces that feel like first-party Apple software today: content-first and calm, legible, with a small **Liquid Glass functional layer** (bars, controls, sheets, menus) floating over opaque content, system type and semantic colors, concentric capsule geometry, springy interruptible motion, and controls that answer every touch.

The most common failure is treating "Apple style" as "blur everything". Current Apple design is the opposite: **content is opaque and primary; glass is reserved for the few controls that float above it** (GL-1). The second most common failure is a UI that looks right in a screenshot but feels dead: no pressed states, fades instead of morphs, sub-44-pt targets. Design the behavior, not just the picture.

## What "latest" means (late 2026)

Liquid Glass arrived with the **26** releases (June 2025); the **27** releases (WWDC26, shipped Sept 2026) refine it — more diffusion, darker edge, brighter highlights, a system Liquid Glass slider, edge-to-edge iPad/Mac sidebars, bars that minimize on scroll, resizable iPhone apps, and no opt-out when building with Xcode 27. Design and test against 27 (GL-12); call out 26 differences when the deployment target is 26. The authoritative timeline is `references/liquid-glass.md` §1; SDK/API deltas are in `references/swiftui.md`.

## Workflow

1. **Recognize the intent** and **compose the reading set** from it (the next two sections). Everything after depends on getting this right.
2. **Structure before styling.** Pick the navigation model and the one primary action per screen first (CMP-1, CMP-2); prefer standard components — familiarity is a feature on Apple platforms.
3. **Design the behavior.** For every control decide its states (FB-3), what motion explains each change (MOT-1, MOT-4), and what confirms the outcome (FB-5). Motion and feedback are part of the design, not polish.
4. **Build to the medium's output contract** (below).
5. **Self-review** with the quick list in `references/review-checklist.md`. Measure, don't eyeball: hit boxes (HIT-1), contrast pairs (CON-2, `scripts/contrast.py`), light + dark + Increase Contrast + reduced motion/transparency.

## Recognize the intent

Before choosing files, components or code, work out what the person is actually trying to achieve. Read the request as a whole together with its context: the conversation so far, attached files and screenshots, and the code or page being worked on. Requests arrive in any language and rarely use this skill's vocabulary, so treat words as evidence of intent, never as switches. A word like "glass" or "Apple" says nothing on its own: a rendering engine's glass shader, an orchard's logo or a crash in SwiftUI code is not a request for interface design, while wanting an app to feel like the phone's built-in apps is one even though it names no platform.

Resolve each dimension, weighing evidence in this order: what the person states, then what their files and code show, then the conversation so far, then sensible defaults.

| Dimension                               | Resolve                                                                                                                                                                                                                                      | What it decides                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal                                    | create · change an existing UI · review or critique · specify for someone else to build · explain · port to Apple platforms                                                                                                                  | The deliverable: new work, a focused change that keeps the existing conventions, ranked findings, a spec, or an explanation                                                      |
| Design language                         | Apple's (stated, or implied when the product is an Apple-platform app and native is the aim) · another one that replaces it (Material, a brand system with its own components) · unspecified                                                 | Whether this skill's conventions apply at all, or only its behavior and accessibility rules                                                                                      |
| Medium                                  | native (SwiftUI, UIKit, AppKit) · web (HTML/CSS/JS, React, Vue, Tailwind …) · cross-platform (Flutter, React Native …) · design artifact (spec, redlines, mockup) · app icon · system surface (widget, Live Activity, notification, control) | The output contract and the implementation reference                                                                                                                             |
| Platforms and version                   | iPhone, iPad, Mac, Apple Watch, Apple TV, Apple Vision Pro; deployment target 26 or 27                                                                                                                                                       | Navigation model, metrics, input methods, API availability                                                                                                                       |
| Scope                                   | one control · a screen · a flow · a whole app or site · a marketing page                                                                                                                                                                     | How much structure to design rather than reuse                                                                                                                                   |
| Emphasis                                | material and look · layout and hierarchy · motion · interaction feedback and haptics · accessibility · writing                                                                                                                               | Which references to add. It is often implied rather than stated: a UI that feels unresponsive needs feedback and motion; one that looks dated needs current metrics and material |
| Fidelity (when the language is Apple's) | faithful to Apple's own apps · Apple-inspired within a brand that sets only color, type or imagery · more of the Liquid Glass material on show                                                                                               | How literally to use system components and how much of the material to show                                                                                                      |
| Inputs                                  | the code, screens, assets and copy you can work from                                                                                                                                                                                         | What you can judge or build now, and what to mark as a placeholder or out of reach                                                                                               |
| Constraints                             | existing code or design system, framework and versions, single-file delivery, size or performance budgets, languages, brand colors                                                                                                           | Hard limits on every later choice                                                                                                                                                |

Then act on what you found:

- **An unknown that would change the deliverable and can't be inferred** (for example native or web, with nothing pointing either way): ask one short question — combine the unknowns into it if there are several — offer your default, and wait for the answer.
- **Anything else unresolved:** state the assumption in one line and proceed. Where inputs are missing, say what you couldn't judge or used placeholders for.
- **Design language unspecified:** keep the product's own look, apply the behavior and accessibility rules (feedback, motion, focus, contrast, hit areas), and offer Apple's conventions rather than imposing them.
- **Another design language replaces Apple's:** follow it and its own numbers. From this skill use only contrast, text scaling, visible focus and reduced motion, and read no component or platform sections. A cross-platform app is often both: Apple's conventions for the iOS build, the other platform's for the rest, unless the person wants one look everywhere.
- **Parts of the task that aren't interface design** (build setup, data, networking, business logic, performance or crash debugging — even in UI code): handle them normally. Bring in a rule from here only where it is the cause, such as glass or materials on every row of a slow list.
- **More of the material on show** (a showcase, or a wish for visibly more glass): make the glass visible the way Apple's own apps do — vivid content (artwork, photography, a color field) beneath floating bars and controls, a floating control over media, the specular rim and glint, morphs between states — while content stays opaque (GL-1, GL-10). Restraint alone reads as plain.
- **A release named as a style rather than a deployment target** (26 as "the new look"): it means the Liquid Glass design; design for 27 and mention visible 26 differences (GL-12).

## Compose the reading set

Build the reading list from the resolved dimensions, not from the request's wording. The references are long: read a file's Rules table and Contents first, then only the sections the task needs (`grep -n '^## ' <file>`, then Read with an offset).

1. **Medium sets the base.**
   - Native: swiftui.md, and look up every API name in its §2 index.
   - Web app, page or component: web.md §1 Quick start, §2 Kit map and §3 Tokens you'll touch to build; §4–§7 and §12 to review.
   - Apple-marketing-style site: web.md §10 in addition to §1–§3, plus §9 (fonts, icons and trademarks).
   - Cross-platform framework: foundations.md and the components.md sections for what you build, expressed with that framework's own widgets.
   - Design artifact (UI specs, mockups, redlines): components.md §8 (spec template).
   - App icon: liquid-glass.md §14 and §1.
   - System surface: system-experiences.md, plus swiftui.md for code.
2. **Emphasis adds.**
   - Material, custom glass, what changed in 26/27: liquid-glass.md.
   - Layout, color, type, symbols, accessibility values, writing, localization: foundations.md.
   - Motion: motion.md (§14 for web recipes; Swift recipes in §3 and §5–§12, animated numbers in §8).
   - Interaction feedback and haptics: interaction-feedback.md (§10 native, §11 web).
   - Particular components: only their sections of components.md.
3. **Platform and version add.**
   - A 26 deployment target: liquid-glass.md §1 and swiftui.md §12.
   - iPad, Mac, Apple Watch, Apple TV or Vision Pro: foundations.md §12, and components.md §2 and §7.4–§7.5.
4. **Goal adds.**
   - Review or critique: review-checklist.md, then the owner sections behind each finding.
   - Port to Apple platforms: components.md for the Apple equivalents and screen recipes, and foundations.md §12 for platform differences. Porting away from Apple's conventions is the other-design-language case.

Intents combine: an animated widget needs system-experiences.md, swiftui.md and motion.md; a review of a web page's motion needs review-checklist.md, web.md §4–§7 and motion.md.

## System map

Each topic has one owner file; rules carry stable IDs so you can look them up and cite them consistently. Other files summarize a rule in one line and cite its ID.

| File                                                                     | Owns                                                                                                                                                                 | Rule IDs                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [references/foundations.md](references/foundations.md)                   | Layout & margins, color & on-color, contrast, typography, hit targets, symbols & images, writing, localization/CJK/RTL, platform differences, cross-medium token map | LAY, COL, CON, TYP, HIT, SYM, WRI, LOC |
| [references/liquid-glass.md](references/liquid-glass.md)                 | The material: layers, glass budget, variants, tint, concentricity, scroll edge, material ladder, accessibility settings, app icons, **the 26→27 timeline**           | GL, ICN                                |
| [references/components.md](references/components.md)                     | Component specs (navigation, presentation, controls, content), patterns, screen recipes, spec template                                                               | CMP, PAT                               |
| [references/motion.md](references/motion.md)                             | Springs, timing, transitions & choreography, glass motion, symbol/content/scroll motion, gestures, loading, Reduce Motion policy, web motion recipes                 | MOT                                    |
| [references/interaction-feedback.md](references/interaction-feedback.md) | State model, touch timing, per-control feedback, haptics, sound, pointer/keyboard/gaze/focus, outcome feedback, hit-area measurement, web state recipes              | FB                                     |
| [references/system-experiences.md](references/system-experiences.md)     | Widgets, Live Activities & Dynamic Island, notifications, controls, complications, App Clips                                                                         | SYS                                    |
| [references/swiftui.md](references/swiftui.md)                           | SwiftUI / UIKit / AppKit recipes and **the API index** (names, availability)                                                                                         | NAT                                    |
| [references/web.md](references/web.md) + `assets/` + `scripts/`          | The web kit (tokens, blocks, JS), glass on the web, performance, frameworks, marketing pages                                                                         | WEB                                    |
| [references/review-checklist.md](references/review-checklist.md)         | Quick self-review and full audit rubric                                                                                                                              | —                                      |

## Core rules (digest)

**Layering & material** — Glass only for the functional layer; content opaque (GL-1). Never glass on glass; group neighbors (GL-2). Budget (heuristic; Apple gives no number): system chrome + ≤ 2–3 custom floating glass controls; web ≤ 6 backdrop-filter surfaces (GL-3). Regular by default; clear only over media with dimming (GL-4). Tint only the one primary action (GL-5). Scroll edge effect instead of bar backgrounds (GL-7). Cards and content surfaces stay opaque (GL-8). Never rely on a specific transparency (GL-9).

**Geometry & layout** — Capsules and concentric radii: inner = outer − padding (GL-6). Lay out by size class and safe areas; content runs edge to edge under bars (LAY-1). System margins 16/20 pt (LAY-2). iOS 26 lists: ≈53-pt rows, 20-pt inset, 26-pt radius (CMP-7). Bottom tab bar on iPhone; on iPad a top tab bar that can become a sidebar; sidebar on Mac (CMP-1).

**Touch** — Every control's hit region ≥ 44×44 pt, measured, including segments, grabbers and stepper halves (HIT-1); keep spacing around controls (HIT-2).

**Type** — System font and Dynamic Type text styles; iOS Body 17, macOS Body 13; ≥ 200 % scaling (TYP-1). Hierarchy by weight and size; bold, left-aligned titles; no ALL-CAPS headers (TYP-2).

**Color & contrast** — Semantic system colors with light/dark/increased-contrast variants (COL-1). One accent; color never the only signal (COL-2). Pick label/glyph color per fill by measured contrast — white fails on yellow/orange/green/mint/teal/cyan (COL-3). Follow the system appearance; no in-app theme toggle (COL-4); a web app adds a settings-only override only when the user or product requires one (WEB-6). Text ≥ 4.5:1, large/bold ≥ 3:1 (web: WCAG large text only, `contrast.py --wcag`), glyphs ≥ 3:1; secondary labels only for supplementary text (CON-1). Check the risky pairs (CON-2).

**Components** — One prominent action per view (CMP-2). In-content buttons are opaque (bordered/filled); glass buttons belong to the floating layer (CMP-3). Toolbars ≤ 3 groups, never mix text and symbol buttons in one capsule (CMP-4). Sheets morph from their source, with grabber and Cancel/Done placement (CMP-5). Undersized controls (segments, switch, glass buttons, grabbers) extend their hit box (CMP-8). Pick the presentation by intent; alerts only for problems (CMP-9). Recreations use the measured OS 26 metrics — 63×28 switch with a pill knob, 31–32-pt segments — never the old 51×31 switch or 44-pt rows (CMP-10). Ask for permissions and sign-in late and in context (PAT-2, PAT-5).

**Motion** — Motion explains, never decorates; keep it brief (MOT-1). Springs by default (MOT-2) with a bounce budget: no visible bounce on taps, state changes and presentations (0, or `.snappy`'s 0.15); 0.15–0.2 when a gesture releases with momentum; 0.3 rarely, for celebration (MOT-7). Interruptible, 1:1 tracking, velocity handoff (MOT-3); decide a released gesture by its projected end point (MOT-8). Things morph from their source and leave the way they came (MOT-4); glass morphs, never fades (MOT-9). Press in fast, release on a spring (MOT-11). One primary motion per moment (MOT-12). Reduce Motion substitutes fades — never just deletes feedback (MOT-5). Web: animate transform/opacity only; never animate blur (MOT-6).

**Feedback** — Highlight on touch-down, act on release inside, cancel on drag-off (FB-1). Hover only for fine pointers (FB-2). Every custom control has pressed, focused, selected and disabled states; disabled is explained, never hidden (FB-3). One semantic haptic per meaningful outcome (FB-4), and never a second press effect, haptic or sound on top of a system control (FB-8). Confirm outcomes in place, errors inline, no toasts by default (FB-5); prefer undo to confirmation (FB-9). Visible focus (FB-6). Busy state lives inside the control (FB-7). Every visual state has an accessible equivalent (FB-10). Measure hit boxes, don't eyeball them (FB-11).

**Icons, writing, localization** — SF Symbols natively matched to text weight; a matching line-icon set on the web (SYM-1). Consistent voice and capitalization (WRI-1). Localize layout: no SF tracking on CJK, full-width punctuation, RTL via logical properties (LOC-1).

**System surfaces** — The system draws widget/Live Activity containers; never add your own glass or blur there (SYS-1).

## Output contracts

- **Native code** — Standard components first: rebuilding with the current SDK gives bars, sheets and controls Liquid Glass for free; remove custom bar backgrounds and blur hacks (NAT-1, NAT-4). Apply glass modifiers after layout modifiers (NAT-2). Gate newer APIs with verified availability (NAT-3); look names up in the swiftui.md §2 API index rather than guessing. Attach floating controls with `.safeAreaBar`, never an overlay (NAT-5). Taps animate with `.snappy`; under Reduce Motion swap movement for a short fade, never a `nil` animation (NAT-7). Typecheck when an SDK is available.
- **Web** — Use the kit, lean (WEB-1): `python3 <skill-dir>/scripts/build_kit.py --list`, copy markup from `--markup <blocks>`, then build only the blocks you use (`… button tabbar sheet --css app.css --js app.js --minify`). For a single-file deliverable, leave empty `<style data-kit>` / `<script data-kit>` tags and fill them as the last step with `--inline index.html` (web.md §1), so the kit never passes through your context; never read or paste the whole kit, the demo or the specimen. Glass must stay legible without `prefers-reduced-transparency`, which Safari doesn't support (WEB-2). Respect performance, accessibility and keyboard parity (WEB-3, WEB-4). Use tokens, not literals — `--accent-text` for accent text, `--link` for links (WEB-9).
- **Cross-platform frameworks** — Use the framework's own components and theming, tuned to the measured metrics, colors, motion and feedback rules here; don't embed the web kit in a native wrapper.
- **Design specs / mockups** — Use the PAT-1 template: element, HIG component name, size in pt, text style, color role, states, motion, accessibility label, platform variant — so an engineer can build it natively without guessing.
- **Reviews** — Rank findings by impact (hierarchy and usability first). Each finding: what's wrong → the principle it breaks, in plain words (plus the Apple guideline it comes from, e.g. "HIG › Materials", when Apple's conventions are the target) → the fix. Then give the corrected version if asked.

Answer in the person's language. Rule IDs (GL-1, FB-4 …) are for your own lookup in these files; the person has never seen them, so keep them out of user-facing answers, code comments and deliverables unless they ask for this skill's vocabulary.

Never use Apple logos or trademarks as branding (the official Sign in with Apple button, used per the HIG, is the exception), and don't present a third-party UI as an Apple product. Out of scope: immersive visionOS experiences (windowed visionOS apps are covered).
