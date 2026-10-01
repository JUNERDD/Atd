# Components & Patterns (OS 26 Liquid Glass, refined in OS 27)

Labels: (heuristic) is this skill's recommendation where Apple publishes no number; (unverified) means not confirmed in an Apple primary source and is the only uncertainty marker.

## Rules at a glance

| ID     | Rule                                                                                                                                                                                | Why                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CMP-1  | Standard components before custom ones; the tab bar navigates, toolbars act.                                                                                                        | System components get glass, morphing, concentric shapes, states, accessibility and every OS refinement for free. Mixing navigation and actions breaks people's map of the app. |
| CMP-2  | Prominence budget: one prominent action per view or region (the HIG allows one or two per view, never side by side); distinguish choices by style, not size.                        | One filled or tinted control says what to do next; several compete and slow the decision.                                                                                       |
| CMP-3  | Button material: in-content buttons are bordered or filled (opaque); glass button styles belong to the functional layer or float over media.                                        | Glass in content blurs the two layers (GL-1) and puts labels on an unknown backdrop; opaque fills keep contrast measurable (COL-3).                                             |
| CMP-4  | Toolbars: ≤ 3 groups; borderless symbols; never a text button and a symbol button in one capsule; one prominent trailing action.                                                    | Groups read as units; a mixed capsule reads as one merged control.                                                                                                              |
| CMP-5  | Sheets morph from their source, have a grabber when resizable, put Cancel leading and Done trailing, and sit inset on glass at partial detents, more opaque at full height.         | Spatial continuity, predictable dismissal, and opacity that signals depth of focus.                                                                                             |
| CMP-6  | Search placement per platform: bottom toolbar or a search tab on iPhone; trailing toolbar (or sidebar) on iPad and Mac.                                                             | Search lands where thumbs and pointers expect it, without covering key content.                                                                                                 |
| CMP-7  | iOS 26 inset-grouped lists: ≈ 53 pt rows, 20 pt section inset, 26 pt section radius, 17 pt semibold headers; 44 pt is a hit-target floor, not a row height.                         | Pre-26 list metrics date a screen at a glance.                                                                                                                                  |
| CMP-8  | A control drawn smaller than HIT-1 (segment, switch, regular glass button, stepper half, grabber, close button) extends its hit region to HIT-1; measure the box.                   | Undersized segments and grabbers are the most common failed target, and hit boxes can't be judged by eye.                                                                       |
| CMP-9  | Choose the presentation by intent (sheet, popover, alert, confirmation dialog, menu, full-screen cover); one at a time; alerts only for problems and uncommon irreversible actions. | The wrong container interrupts too much or too little.                                                                                                                          |
| CMP-10 | Recreations (web, Figma, custom controls) use the measured OS 26 metrics in Part A, never outdated ones (51×31 switch, 44-pt rows, 36-pt segments).                                 | Old geometry is what makes a copy look fake.                                                                                                                                    |
| PAT-1  | Spec each element as: element · HIG component · size (pt) · text style · color role · states · motion · accessibility label · platform variant.                                     | Engineers can build natively without guessing, and reviewers can cite rules.                                                                                                    |
| PAT-2  | Ask late and in context: sign-in, permission, notification and rating requests come after people see value, never at launch unless the app can't work without them.                 | Requests without context get denied, and denials are hard to undo.                                                                                                              |
| PAT-3  | Use the system experience for system jobs: share sheet, Sign in with Apple button, passkeys and AutoFill, rating prompt, empty-state view.                                          | They're familiar, private and accessible, and the OS keeps them current.                                                                                                        |
| PAT-4  | Empty states explain why and offer the next step; never a blank screen or a disabled tab.                                                                                           | A blank screen looks broken.                                                                                                                                                    |
| PAT-5  | Permission priming: at most one custom screen, with one Continue button that opens the system alert; never "Allow", never an imitation alert.                                       | People decide in the system alert they trust; manipulative priming also fails App Review.                                                                                       |
| PAT-6  | The launch screen mirrors the first screen, with no text, logo or splash look; restore where people left off.                                                                       | Launch should feel instant; it isn't a branding moment.                                                                                                                         |

Component specs, patterns and screen recipes for Apple's current design language, as of 2026-09-30 (the 27 releases). This file owns component placement, anatomy, counts, button material, prominence and component metrics. Everything else is cited by the owner's rule ID, never restated:

| Topic                                                                         | Owner (rule IDs)                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| Glass material, variants, glass budget, the 26 → 26.1 → 27 design timeline    | `liquid-glass.md` (GL); timeline in §1               |
| Layout, color, contrast, type, hit targets, symbols, writing                  | `foundations.md` (LAY, COL, CON, TYP, HIT, SYM, WRI) |
| States, press/hover/focus, haptics, per-control feedback, hit-box measurement | `interaction-feedback.md` (FB)                       |
| Curves, transitions, morphs, gesture physics, Reduce Motion                   | `motion.md` (MOT)                                    |
| Widgets, Live Activities, notifications, controls                             | `system-experiences.md` (SYS)                        |
| API spellings, availability, SDK 27 changes                                   | `swiftui.md` (NAT); SDK list in §2                   |

**27:** marks an OS 27 change. "Measured" values come from the iOS 26.3 runtime (iPhone 17, 402-pt window); the 27 releases aren't documented to change them (unverified).

## Contents

- **[Part A: Component specs](#part-a-component-specs)**
  1. [Ground rules](#1-ground-rules)
  2. [Navigation](#2-navigation): tab bar, sidebar, navigation bar, toolbar, split views, inspectors
  3. [Presentation](#3-presentation): sheets, popovers, alerts, confirmation dialogs, menus, full-screen covers
  4. [Controls](#4-controls): buttons and the CMP-3 name map, toggles, sliders, segmented controls, steppers, pickers, text fields, progress, search
  5. [Content](#5-content): lists and tables, collections, cards
- **[Part B: Patterns](#part-b-patterns)**: [6. Patterns](#6-patterns): onboarding, settings, forms, empty states, permissions, accounts and sign-in, notifications, launch, share, charts, page controls, ratings
- **[Part C: Recipes and specs](#part-c-recipes-and-specs)**: [7. Screen recipes](#7-screen-recipes) · [8. Spec template (PAT-1)](#8-spec-template-pat-1) · [9. Sources](#9-sources)

## Part A: Component specs

## 1. Ground rules

The design has two layers: the **content layer** (your lists, media and text, opaque) and a **functional layer** of Liquid Glass (bars, floating controls, sheets, menus) above it. The 27 releases tune legibility and add user control; they keep this model.

- **CMP-1** Use standard components before custom ones (NAT-1). They adopt glass, morphing, concentric corners, states and accessibility, and pick up each OS refinement without code. The tab bar moves between sections; toolbars act on content.
- **CMP-10** When you recreate system components (web, Figma, custom controls), use the measured metrics in this file (tab bar §2.1, navigation bar §2.3, buttons §4.1, switch §4.2, segmented control §4.4, lists §5.1), never outdated or invented ones such as the pre-26 51×31 switch, 44-pt list rows or 36-pt segments.
- Glass stays in the functional layer: no glass cards, rows or scrolling backgrounds, and never glass on glass (GL-1, GL-2). Knobs and thumbs turning to glass while touched is the transient exception (§4.2–§4.4).
- No custom bar backgrounds, tints, dividers or scrims; the scroll edge effect separates bars from content (GL-7, NAT-4).
- Bar symbols stay monochrome, only the single primary action is tinted (GL-5), and color never carries meaning alone (COL-2).
- Content runs edge to edge beneath bars and sidebars (LAY-1); margins come from the system layout margins, never constants (LAY-2). Shapes are capsules or concentric with their container (GL-6).
- Every control's hit region meets HIT-1 whatever its visual size (CMP-8), with HIT-2 spacing. Custom controls show the pressed state on touch-down (FB-1) and implement the full state set (FB-3).
- One prominent action per view or region (CMP-2); in-content buttons are opaque (CMP-3).
- Never assume a glass opacity. Test with Reduce Transparency, Increase Contrast, Reduce Motion and both ends of the 27 Liquid Glass slider, which runs from ultraclear to fully tinted on iOS and macOS (GL-9, MOT-5; liquid-glass.md §1).

## 2. Navigation

### 2.1 Tab bar

**Purpose:** switch between top-level sections while keeping each section's navigation state. Navigation only (CMP-1).
**Anatomy:** filled SF Symbol plus a one-word label; a badge only for critical counts; an optional search tab at the trailing end; an optional bottom accessory.

| Aspect                 | Spec                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Form (iPhone)          | A floating glass platter **62 pt** tall with 4-pt padding; each tab is a **54-pt** capsule; a clear-glass lens marks the selection (measured). Content scrolls beneath it.                                                                                         |
| Icon and label         | Stacked in compact width, side by side in regular width.                                                                                                                                                                                                           |
| Minimize on scroll     | Optional: collapses on scroll down; returns on scroll up, a tab tap, or reaching the top (swiftui.md §5).                                                                                                                                                          |
| Bottom accessory       | One persistent, app-wide control, like Music's mini player, docked above the bar. It moves inline when the bar minimizes, so give it a compact inline layout. Screen-specific actions (Checkout) belong in the content.                                            |
| Search tab             | At the trailing end, in the standard or button appearance (§4.9).                                                                                                                                                                                                  |
| Prominent tab          | **27:** one tab can be prominent (Cart, Tickets). It's pinned to the trailing edge and stays visible when the bar collapses (documented for UIKit). It is still a destination, never an action. Without one, the search tab may get the treatment (swiftui.md §2). |
| Customization (iPadOS) | People choose which items the bar holds; default to five or fewer.                                                                                                                                                                                                 |

- As few tabs as the hierarchy needs, and at most five on iPhone: more creates a More tab, which the HIG says to avoid. Three to five is typical (heuristic). For more sections, use a sidebar-adaptable tab view on iPad (§2.2). Keep the bar visible while people navigate inside a section; only modal views cover it.
- Never disable or hide a tab; explain an empty section instead (PAT-4). No custom background, blur or border (GL-7); no accent-colored labels that echo colorful content (GL-5).
- iPhone Duo: bars move to a vertical side rail on the outer display and on the inner display in landscape; inner portrait keeps horizontal bars (liquid-glass.md §1; APIs in swiftui.md).

**Platforms:** iPad: at the top; sidebar-adaptable apps can turn it into a sidebar. Mac: use a sidebar. visionOS: vertical on the leading side, with labels appearing when people look at it. watchOS: vertical pages instead. tvOS: a 68-pt bar at the top.

### 2.2 Sidebar

**Purpose:** navigate a broad or deep app when there's horizontal room (iPad regular width, Mac, visionOS).

| Aspect          | Spec                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Form            | A glass panel above the content, inset and floating in 26. **27:** it extends edge to edge on iPad and Mac while still refracting the content, and macOS shows the selected item in semibold (liquid-glass.md §1). |
| Content beneath | Let hero art continue underneath with the background extension effect, which mirrors and blurs the adjacent image. Keep text and controls out of the mirrored zone.                                                |
| Hierarchy       | Two levels at most, with disclosure groups; deeper trees get a middle column (three-column split view).                                                                                                            |
| Icons           | SF Symbols in the accent color (**27:** accent-colored again, with per-item tint). Fixed colors only when they carry meaning, like Mail's yellow VIP star. macOS follows the user's accent color.                  |
| Size (macOS)    | The system small/medium/large setting drives row height and glyph size.                                                                                                                                            |
| Visibility      | People can hide and show it (edge swipe on iPad; a toolbar button and the View menu on Mac). Don't hide it by default.                                                                                             |

- Allow reordering and customization; use short group labels; keep the selection highlighted.
- No critical actions at the bottom of a Mac sidebar (windows get dragged partly off-screen); no bitmap icons; never a tab bar and a sidebar on screen together.
- Choosing: a tab bar first on iPhone and for simple iPad apps; sidebar-adaptable when there are many sections; a split view for sidebar-first apps. **27:** iPhone apps can opt into a sidebar in regular width; the tab bar stays the default (swiftui.md §2).

### 2.3 Navigation bar and large titles

**Purpose:** show where people are, the way back, and a few actions for the view. In the new design it's a transparent bar of grouped glass items, not a filled bar.

| Aspect         | Spec                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Height         | **54 pt** for the inline bar (measured). A large title adds its own row and collapses into the inline bar on scroll.            |
| Large title    | At the root of a scrolling screen; it collapses on scroll and returns at the top. Titles are bold and leading-aligned.          |
| Back and Close | The standard chevron and X symbols; never "Back" or "Close" as text.                                                            |
| Title          | About 15 characters or fewer when items share the row; never the app name.                                                      |
| Background     | None; the scroll edge effect separates the bar from content (GL-7).                                                             |
| Items          | Toolbar rules apply (§2.4, CMP-4); each item's hit region meets HIT-1 even when its glyph is smaller.                           |
| Minimize       | **27:** the bar can slide away on scroll. The system decides by default; you can force it on or off per screen (swiftui.md §2). |

### 2.4 Toolbar

**Purpose:** actions on the current content, plus navigation and search. On iPhone it sits at the top (the navigation bar) or bottom; on iPad and Mac it's the window toolbar.

| Zone     | Contains                                                       | Notes                                                                                        |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Leading  | Back, sidebar toggle, title, document menu                     | Not customizable; always available.                                                          |
| Center   | Common tools                                                   | Customizable on iPad and Mac; collapses into the system overflow menu as the window narrows. |
| Trailing | Inspector toggle, search, More menu, the primary action (Done) | Stays visible at all widths.                                                                 |

- **CMP-4** Items share one glass capsule per group. Group by function and frequency, **three groups at most**. Separate groups with a fixed spacer, and hide the shared background for items such as an avatar (swiftui.md §5).
- Prefer borderless system symbols: the glass is the container, so no outlined-circle symbols. Use text only when no symbol says it (Edit). Never put a text button and a symbol button in one capsule; give text buttons their own group.
- One primary action, trailing, in the prominent style (GL-5, CMP-2): a tinted checkmark for Done on iOS, a prominent text button on macOS.
- Overflow: decide which items leave first as the width shrinks. iPad and Mac add the overflow menu themselves, so don't build your own or overflow by default. **27:** visibility priorities keep key items (Undo, Redo) visible longest; an explicit overflow container holds less-used actions (Archive, Delete); a pinned trailing placement moves to overflow only when search is active and space runs out (iOS, iPadOS, visionOS; swiftui.md §2).
- Badges go on the item. iPad: the toolbar and tab bar can share the top row. macOS: every toolbar item also has a menu-bar command; items have no bezels; the title sits inline.
- watchOS: toolbar buttons in the top corners and along the bottom get glass automatically. visionOS: a toolbar along the bottom edge; no vertical toolbars; avoid pull-down menus.
- iPhone Duo: bars move to a vertical side rail on the outer display and on the inner display in landscape; inner portrait keeps horizontal bars (liquid-glass.md §1; APIs in swiftui.md).

**Scroll edge effect** under bars: never add your own divider or blur. Keep the automatic style (**27:** it gives the top bar a uniform, more opaque treatment, and the HIG prefers it). Force soft only after testing legibility; hard suits macOS, pinned table headers and text without glass behind it. One effect per view; each split-view pane may have its own, with matching heights (GL-7; liquid-glass.md §8).

### 2.5 Split views and windows

**Purpose:** show several levels of hierarchy at once (sidebar > list > detail).

- Regular width only; in compact width the split view collapses into a stack automatically.
- iPad: two or three columns. Test narrow, compact and intermediate widths: windows resize freely, and **27:** iPhone apps resize too (on iPad and in iPhone Mirroring). Lay out by size class and width, not by device (LAY-1).
- Keep the selection highlighted in each pane that leads to the detail; support drag and drop between panes.
- macOS: thin 1-pt dividers, sensible minimum and maximum pane widths, and two ways back to a hidden pane (a toolbar button and a menu command with a shortcut).
- Each pane can have its own toolbar section and scroll edge effect; search usually sits at the trailing end of the toolbar (CMP-6).
- In inactive iPad windows the glass recedes (27 details: liquid-glass.md §1); dim custom chrome to match (swiftui.md §2).

### 2.6 Inspectors

**Purpose:** properties of the current selection (Mac, iPad, visionOS).

- A trailing glass panel tied to the selection. Toggle it from a trailing toolbar item (the `sidebar.trailing` symbol) and remember its state per window.
- In compact width it presents as a sheet, so its content must work at sheet detents. Don't duplicate inspector content in a popover; pick one.

## 3. Presentation

**CMP-9** Choose the container by intent, and present one at a time.

| Intent                                               | Container                  |
| ---------------------------------------------------- | -------------------------- |
| A self-contained task, or supplementary content      | Sheet (§3.1)               |
| A few controls anchored to their trigger (iPad, Mac) | Popover (§3.2)             |
| A problem, or an uncommon irreversible action        | Alert (§3.3)               |
| Choices about an action the person just started      | Confirmation dialog (§3.4) |
| Commands people asked for                            | Menu (§3.5)                |
| Media, the camera, or a long multistep task          | Full-screen cover (§3.6)   |

Menus, alerts, popovers and confirmation dialogs morph out of the glass control that opened them automatically; sheets do it through the zoom transition (§3.1). Always anchor a presentation to its source. Timing and choreography: MOT-4 (motion.md §5).

### 3.1 Sheets

**CMP-5** A sheet morphs from its source, has a grabber when resizable, puts Cancel leading and Done trailing, and sits inset on glass at partial detents, turning more opaque at full height.

| Aspect        | Spec                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Look          | Partial-height sheets are inset on Liquid Glass, with bottom corners concentric with the display. At full height the glass turns more opaque and the sheet meets the screen edges (liquid-glass.md §10). Remove custom sheet backgrounds to get this (NAT-4).                                     |
| Detents       | Large is automatic. Add medium for progressive disclosure; medium alone prevents expanding; custom heights are allowed (swiftui.md §5.5). Compose flows (Mail, Messages) stay full height.                                                                                                        |
| Grabber       | On every resizable sheet: drag it to resize, tap it to cycle detents, and VoiceOver can resize with it. In recreations, give it a HIT-1 hit region, or keep it decorative and dismiss with Cancel or Done (CMP-8).                                                                                |
| Morph         | The sheet grows out of the tapped control through the zoom transition (swiftui.md §5.5) and returns into it. Morph timing: MOT-4; drag tracking and release velocity: MOT-3 (motion.md §5, §10). **27:** a cross-fade transition for sheets and full-screen covers (not on macOS; swiftui.md §2). |
| Dismissal     | Swipe down always works. With unsaved changes, confirm with a dialog anchored to the sheet (FB-9).                                                                                                                                                                                                |
| Modality      | Interrupting task: glass plus dimming. Parallel task (Notes formatting): glass only, and the parent stays interactive. Deeper focus: larger and more opaque.                                                                                                                                      |
| One at a time | Close the first sheet before presenting another.                                                                                                                                                                                                                                                  |

**Buttons.** Single view: Cancel or Close (X) leading; Done or the confirming action (checkmark, prominent) trailing. Multistep (HIG, March 2026): the first step has Cancel and an inactive Done, middle steps Back and an inactive Done, the last step Back and an active Done. Never show Cancel, Back and Done together; never Done alone.
**Platforms:** iPad prefers a form or page sheet centered over dimmed content. Mac: a card over its window, with the parent dimmed and other windows usable; consider a panel for repeated input. visionOS: centered in view. watchOS: full screen, Cancel as a symbol only, no Back.

### 3.2 Popovers

A small, transient view anchored to its trigger, for a few related controls (iPad and Mac in practice).

- The arrow points at the trigger and never covers it or the content it edits. One at a time, never cascading; only an alert may appear on top.
- Closes on an outside tap and saves work automatically; add Done and Cancel only when discard vs save matters.
- Not for warnings (use an alert). In compact width it becomes a sheet, so design for both; Mac popovers can detach into panels. Not on tvOS or watchOS.

### 3.3 Alerts

- Only for problems and uncommon irreversible actions (CMP-9). Not for information, common undoable deletes (offer Undo instead: FB-9), or at launch.
- A title, an optional message and up to three buttons (HIG); a text field when needed, such as a password (iOS, iPadOS, macOS, visionOS). A specific title ("Couldn't Save Photo", not "Error") capitalized per WRI-1; a message only if it adds something. Alert type is bolder and leading-aligned in the new design (WWDC25 356).
- Buttons: one or two words naming the result ("Delete", "Replace"); "Cancel" to cancel; "OK" only in informational alerts. The default button goes trailing (or on top), and Cancel is never the default. Use the destructive style only when the person didn't deliberately choose the destructive action. With a hardware keyboard, Esc or ⌘-period cancels.
- **27 SDK:** item-binding variants of alerts and confirmation dialogs are back-deployed, so don't gate them on 27 (swiftui.md §2).

### 3.4 Confirmation dialogs (action sheets)

- For choices about an action the person just started (Mail: Delete Draft, Save Draft, Cancel); not for information, and not instead of a menu.
- They spring from the tapped control. Attach the dialog to the source button, not a distant ancestor: an anchored dialog drops the Cancel button (tapping outside cancels), while a dialog without a source is centered and keeps Cancel (WWDC25 284).
- Destructive choices first and red; Cancel last when shown; no scrolling; a short one-line title; a message only if needed.
- Not on visionOS; watchOS allows four buttons at most, including Cancel.

### 3.5 Menus and context menus

| Type                        | Use                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| Pull-down button (menu)     | Actions related to the button (More, Sort).                                                         |
| Pop-up button (menu picker) | One of several mutually exclusive options; shows the current value.                                 |
| Context menu                | A few frequent actions for a long-pressed or right-clicked item; never the only route to an action. |

- Icons: give every item in a group an icon, or none (HIG), and use the standard symbols for Share, Print, Search and Delete. Icons sit at the leading edge, and macOS menus use them too (26). **27:** iPad and Mac menu bars show a minimal set of icons by default, reserved for key actions (WWDC26); UIKit can opt an item in (swiftui.md §2); the SwiftUI opt-in is (unverified).
- Labels: verb phrases in title case, with an ellipsis when more input follows. Dim unavailable items in menus; hide them in context menus. Group with separators; destructive items go last, in red.
- Submenus: one level of about five items, only when a term repeats within a group. Toggle items: changing labels (Show/Hide) or a checkmark.
- iOS and iPadOS layouts: small (four icon-only items on top, for closely related actions such as text styles), medium (three icon-and-label items on top), large (the default list).
- Context menus: the system lifts the preview and dims the background; don't rebuild it on a custom long press (FB-8). **27:** context menus use glass (unverified). visionOS: small and large layouts; a subtle breakthrough effect keeps menus visible.

### 3.6 Full-screen covers

For media viewing, the camera, or a long multistep task (photo or document editing) that should hide the parent entirely. Offer an obvious dismiss (X at top leading, or Done), confirm before discarding work, title the task, and keep one path through it. **27:** a cross-fade transition, as for sheets (§3.1).

## 4. Controls

**CMP-8** A control drawn smaller than HIT-1 keeps a HIT-1 hit region: segments (31–32 pt), the switch (28 pt), a regular glass button (34.3 pt), stepper halves, grabbers and close buttons. Extend the tappable box (padding or an invisible extension), not the visual, then measure it (FB-11).

Standard controls already play their press, glass knob and thumb, selection and haptic feedback: never add a second press effect, haptic or sound on top (FB-8), and keep haptics to their documented meaning (FB-4).

### 4.1 Buttons

**CMP-3** Button material follows the layer. A button in the content layer (a list, card, form or onboarding page) is bordered or filled, which is opaque. Glass button styles belong to the functional layer (bars, floating controls) or float over media (photos, video, maps). Glass in content blurs the two layers (GL-1) and puts labels on an unknown backdrop; opaque fills keep contrast measurable (COL-3, CON-2).

| Role                         | Web class        | SwiftUI style               | UIKit configuration | Layer                                               |
| ---------------------------- | ---------------- | --------------------------- | ------------------- | --------------------------------------------------- |
| Primary in content           | `.btn-filled`    | `.borderedProminent`        | `.filled()`         | Content: solid accent fill, on-accent label (COL-3) |
| Secondary in content         | `.btn-bordered`  | `.bordered`                 | `.gray()`           | Content                                             |
| Secondary in content, tinted | `.btn-tinted`    | `.bordered` with a tint     | `.tinted()`         | Content                                             |
| Tertiary (text)              | `.btn-plain`     | `.borderless` (or `.plain`) | `.plain()`          | Any                                                 |
| Secondary, bars or floating  | `.btn-glass`     | `.glass`                    | `.glass()`          | Functional layer, or over media                     |
| Primary, bars or floating    | `.btn-prominent` | `.glassProminent`           | `.prominentGlass()` | Functional layer, or over media (GL-5)              |

Web modifiers: `.btn-destructive` (the destructive role: red label, never the primary role), `.btn-icon` (icon-only circle, always with an accessibility label), `.btn-block` (full width), `.btn-large` (large size). UIKit names are `UIButton.Configuration` factories; SwiftUI and UIKit spellings were checked against the iOS 26.2 SDK, and exact availability is in the swiftui.md §2 API index (gating: §12). Clear variants (`.glass(.clear)`, `.clearGlass()`, `.prominentClearGlass()`) go only over rich media (GL-4).

- **Floating glass** is legitimate over maps, media and canvases, or when the person asks for a floating action. Attach it to the bottom safe area as a safe-area bar (swiftui.md), never as an overlay, so it respects scroll insets and the scroll edge effect; it counts toward the glass budget (GL-3). On a list screen, the primary action's default home is a trailing toolbar button, not a floating action button.
- **CMP-2** One prominent action (filled or glass prominent) per view or region. The HIG allows one or two per view, so a second must lead a separate region (a sheet's Done plus an in-content primary) and never sit beside the first. Distinguish choices by style, not size: a pair shares one size, the preferred option gets the prominent style, and the other is bordered or plain.
- **Shape:** bordered buttons are capsules by default on iOS. macOS: mini, small and medium keep rounded rectangles for density; large and the new X-Large (macOS 26) are capsules.
- **Sizes (measured):** a regular `.glass` button is 34.3 pt tall, below HIT-1, so extend its hit region (CMP-8) or use large. `.glassProminent` at large is 50.3 pt. On iOS, extra-large resolves to large (the same 50.3 pt); visionOS and macOS (X-Large, above) have a real extra-large size.
- **Roles:** normal; primary (accent color, responds to Return, closes sheets and alerts); cancel; destructive (red). Never give the primary role to a destructive action.
- **Labels:** start with a verb, in title case ("Add to Cart"). Use icon-only buttons only for familiar symbols (`square.and.arrow.up`), always with an accessibility label.
- **States:** system styles have them all; a custom button shows pressed on touch-down (FB-1). While loading, show an indicator inside the button plus a progressive label ("Checking Out…") and ignore repeat taps (FB-7). **27:** on macOS, interactive glass bounces on click (liquid-glass.md §1).
- **Full-width primary (iPhone):** a large capsule inset by the system margins (LAY-2), pinned above the bottom safe area, never inside the tab bar. It's filled in content and glass prominent when it floats (CMP-3).
- **Platforms:** macOS has push buttons (with an ellipsis when they open more UI), square buttons (symbols only, inside views, not toolbars), one help button per window, and tooltips after hover. watchOS: capsule inline buttons, with a full-width primary. visionOS: its own glass when floating and a thin material on a window; the 26 glass styles aren't available there.
- **Custom glass controls:** prefer the system glass styles. Put interactive custom glass only on controls or containers of controls (FB-12), grouped in one container (GL-2, GL-3; code: swiftui.md §4).

### 4.2 Toggles

| Part       | iOS 26 (measured)                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Track      | **63×28 pt** capsule (radius 14; intrinsic width 61). Green when on by default; change it only for a reason, and keep contrast with the off state.                                                              |
| Knob       | **37×24 pt** pill, a capsule wider than tall, at a 2-pt inset with **22 pt** of travel. It turns into Liquid Glass while touched or dragged, a lens over the track; that's system feedback, so add none (FB-8). |
| Hit region | At least HIT-1; the 28-pt visual needs an extended box in recreations (CMP-8).                                                                                                                                  |

- Use a switch only in list and form rows, where the row's label is its label. Elsewhere use a toggle-style button: an icon whose background changes when it's on (a highlighted filter button).
- Never show state by color alone (COL-2); the knob position carries it too. The pre-26 51×31 switch with a round knob is out of date (CMP-10).
- macOS: switches for emphasized settings (mini switches in dense forms), checkboxes for hierarchies and mixed states, radio buttons for 2–5 exclusive options (a pop-up button for more). Keep them in the window body, not the toolbar.

### 4.3 Sliders

- The fill runs from the minimum to the thumb: minimum on the leading side (bottom when vertical), maximum trailing. Optional icons at both ends show what the values mean.
- 26 adds tick marks (automatic with a step, or at chosen values) and a **neutral value** that starts the fill at a midpoint for speed, exposure or balance (swiftui.md). The thumb turns to glass while dragged (FB-8).
- Not for volume on iOS (use the system volume view). Pair with a text field or stepper when precision matters over a wide range; label the ends (and periodic ticks on nonlinear scales). Prefer horizontal sliders on visionOS.

### 4.4 Segmented controls

- For closely related choices that change one view: 2–5 segments on iPhone (5–7 in wide layouts), equal widths, all text or all icons, noun labels. To switch app sections, use a tab bar. A control either selects or acts, never both.
- Visual height is **31–32 pt** (measured: SwiftUI 31, UIKit 32). Each segment's hit region still meets HIT-1, so extend it vertically (CMP-8); never recreate 36-pt segments (CMP-10).
- The selection thumb turns to glass during interaction (FB-8). macOS: in the main window area use a tab view; segmented controls belong in toolbars and inspectors.

### 4.5 Steppers

A compact − / + pair that shows no value itself: always place it next to the visible value, and add a text field when big jumps are likely. Each half gets its own HIT-1 hit region (CMP-8); press and hold repeats, so custom steppers must repeat too. Mac: Shift-click for larger steps. Not on watchOS or tvOS.

### 4.6 Pickers

A pull-down or pop-up menu for short lists; a wheel for medium-to-long ordered lists (countries, minutes). Date pickers: compact when space is tight (a button that opens a calendar), inline for calendars, wheels for numeric entry; use 5-, 10- or 15-minute intervals when finer detail isn't needed. Show pickers in context (below the field or in a popover), not on a new screen. watchOS: Digital Crown wheels.

### 4.7 Text fields

- For short input (a text view for long input). The placeholder is only a hint; add a persistent label when the purpose could be forgotten. Use secure fields for secrets. Set the right keyboard and content type so AutoFill works (§6.6). Validate an email when the field loses focus and a username as people type, with errors inline (FB-5). Web input attributes: web.md.
- iOS: a trailing clear button; a leading image can show the purpose; consistent widths, stacked vertically. Fields sit in grouped-list rows or rounded rectangles; capsule fields suit search and chat compose bars.

### 4.8 Progress indicators

- Determinate (bar or ring) whenever the duration is known; switch from indeterminate to determinate when you can; never switch from a spinner to a bar. Keep it moving (MOT-1; motion.md §11) and name the task ("Downloading 3 of 12 photos"), not "Loading…".
- Show progress in a consistent place. Offer Cancel when stopping is safe, and Pause plus Cancel when cancelling loses work. Short waits: inside the control (§4.1, FB-7).
- Pull to refresh only supplements automatic refresh. Show cached content or placeholders at once, never a blank screen.

### 4.9 Search

**CMP-6** Put search where the platform expects it.

| Placement                               | When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bottom toolbar** (the iPhone default) | Search matters and there's room. The field (or a button) rises above the keyboard and shares the bottom toolbar, its width adapting to its neighbors (positioning: swiftui.md §5).                                                                                                                                                                                                                                                                                                                                      |
| Top toolbar                             | Content at the bottom must stay uncovered (Wallet passes), or there's no bottom toolbar.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Search tab                              | Global search one tap away, at the trailing end of the tab bar. The **standard tab** matches the other tabs and opens a page of suggestions (exploration, as in Apple TV). The **button appearance** focuses the field and raises the keyboard at once, then returns to the previous tab (finding a known item). **27:** both appearances are current. The button appearance is Search as the prominent tab, which it may become by default when no other tab is prominent (WWDC26 292); only one tab can be prominent. |
| Inline field                            | Filters one list: under the title, pinned to the top toolbar on scroll.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

- iPad and Mac: the trailing end of the toolbar in split-view apps; the top of the sidebar to filter navigation; or a sidebar or tab item for discovery, which focuses the field at once (except on iPad with only the software keyboard). Keep iPad and Mac consistent, and handle narrow windows.
- When search is secondary, minimize the field to a button (swiftui.md §5).
- Quality bar: a placeholder naming the scope; results as people type; recent searches (swipe to delete, Clear All); suggestions; a scope bar for coarse filters (start broad); tokens for filters, paired with suggestions; a "No Results" state that shows the query (PAT-4).
- Anatomy: a leading magnifier, the placeholder, a clear button once typing starts, and Cancel while focused (iOS). Glass in toolbars; standard styling inside scrolling content.

## 5. Content

### 5.1 Lists and tables

**CMP-7** iOS 26 inset-grouped lists use these metrics (measured at 402-pt width):

| Part                               | iOS 26                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Row (default, one line)            | ≈ **53 pt**                                                                                                                  |
| Section inset from the window edge | **20 pt**                                                                                                                    |
| Section corner radius              | **26 pt**                                                                                                                    |
| Section header                     | **17 pt semibold** (emphasized Body, measured weight 0.3), secondary label color, title-style capitalization, never all caps |
| Section footer                     | 13 pt regular (Footnote)                                                                                                     |

44 pt is the hit-target floor (HIT-1), not a row height. The section inset is a list metric of its own, wider than the system margin at this width (LAY-2). Apple describes the change as "a larger row height and padding" and "an increased corner radius" (Adopting Liquid Glass). The older values (44-pt rows, a 16-pt inset, 13-pt all-caps headers) date a screen (CMP-10).

- Styles: inset grouped is the iOS default; plain for feeds and long uniform lists; the sidebar style in split views.
- Rows: a leading icon or image, a title (and a secondary subtitle), a trailing value or accessory. A chevron navigates deeper; an info button only reveals more about the row; a switch, menu or stepper is an inline control. Keep text short and truncate filenames in the middle. No alphabetical index when rows have trailing accessories.
- Selection: navigation lists keep the selected row highlighted in split views; option lists flash the row, then show a checkmark (FB-3). Edit mode handles multiple selection. Swipe actions: trailing for destructive ones (last), leading for positive ones such as Pin. **27:** swipe actions and drag-to-reorder work in any container, grids included; reorder also works on watchOS (swiftui.md §2).
- Pinned section headers use the scroll edge effect, with no fill (GL-7). Separators are inset hairlines in the separator color (COL-1).
- macOS: sortable, resizable columns; alternating row colors for wide tables; outline views for hierarchies. watchOS: short lists in elliptical or carousel styles.

### 5.2 Collections and grids

- Image-heavy content: adaptive columns (two on iPhone in portrait, more as the width grows) in standard row or grid layouts, not exotic custom ones. Leave room for focus, hover and press states, and don't re-lay out while people interact.
- Concentric corners: image radius = container radius − inset (GL-6). Horizontal carousels may scroll beneath sidebars and screen edges. Text belongs in a list, not a grid.

### 5.3 Cards

Not a HIG component: a card is a rounded container in the content layer, with an opaque grouped fill and no glass (GL-8). Use cards for grouped summaries on home screens and dashboards.

- Radius: match the grouped-list section radius (26 pt, CMP-7) or stay concentric with the parent (GL-6). Use the system margins (LAY-2), and separate cards with space, not shadows or strokes.
- One clear tap target (the whole card navigates) plus at most one secondary control; buttons inside are bordered or filled (CMP-3).
- Hero cards may use full-bleed imagery with a scrim in the content (not glass) for legible text; check that text against the image (CON-2).

## Part B: Patterns

## 6. Patterns

Short on purpose: Part A's component rules still apply. Two rules span every pattern:

- **PAT-2** Ask late and in context. Sign-in, permission, notification and rating requests come after people have seen value, at the moment the benefit is obvious; never at launch unless the app can't work without them.
- **PAT-3** Use the system experience for system jobs: the share sheet, the Sign in with Apple button, passkeys and AutoFill, the system rating prompt and the system empty-state view. They're familiar, private and accessible, and the OS keeps them current.

### 6.1 Onboarding

- Optional, brief and interactive: teach by doing, and prefer contextual tips (TipKit) to a carousel. Make a tutorial skippable, and findable later in help or settings.
- Postpone setup, sign-in and rating requests (PAT-2); no licensing text; no large downloads before first use. Ask for a permission here only if the app can't work without it, and say why (PAT-5).
- Layout: a bold, leading-aligned title; one full-width filled Continue button at the bottom (CMP-2, CMP-3); Skip as a plain button; a page control only for a short, flat sequence (§6.11). A splash graphic, if you truly need one, opens onboarding briefly; it's never the launch screen (PAT-6).

### 6.2 Settings

- Few settings, strong defaults; task options live in the task. Don't duplicate systemwide settings (appearance, accessibility, authentication methods such as a biometric opt-in); link to your app's page in the Settings app when needed.
- iOS: an inset-grouped list (CMP-7) of switches, menu pickers and navigation rows, with explanations in section footers. Sign Out and destructive items get their own last section; put search at the bottom when the list is long (recipe §7.3).
- Mac: a Settings window opened from the App menu (⌘,), not a toolbar button, with a non-customizable toolbar of pane icons, the pane name as the window title, the last pane restored, and minimize and zoom dimmed. watchOS: a few essential options at the bottom of the main view or in a More menu.

### 6.3 Forms

- An inset-grouped form: label leading, value or control trailing; related fields under a header. Validate inline, beside the field or in the footer, with text plus an icon (FB-5).
- Submit: in a sheet, Done or Add trailing (prominent) with Cancel leading, and Done inactive until the form is valid (say what's missing); in a flow, a full-width button at the bottom. The keyboard offers Next and Done.
- Compact date and time pickers; menu pickers for choices; long option lists push to a selection screen. Set the right keyboard and content types for AutoFill (§4.7).

### 6.4 Empty states

**PAT-4** An empty state explains why and offers the next step; never a blank screen, and never a disabled or hidden tab.

- Use the system empty-state view: symbol, short title, one-line explanation, optional action (swiftui.md). For search: "No Results for 'query'".
- Errors and offline: keep cached or placeholder content with a quiet status in place, not an alert at launch (FB-5).

### 6.5 Permissions and priming

**PAT-5** Priming is optional and honest. Show at most one custom screen before the system alert, with one button, titled Continue or Next, that opens the alert. Don't title it "Allow", don't offer a way out that skips the alert, and don't mimic the system alert (HIG Privacy). People should decide in the alert they trust; manipulative prompts also fail App Review (guideline 5.1.1).

- Request when people first use the feature (PAT-2). The purpose string says what you'll do with the data in one specific sentence.
- Ask for the least: approximate location unless precise is needed; the system photo picker needs no permission at all.
- After a denial, keep working in a reduced mode and explain how to turn access on in Settings; don't ask again in a loop.

### 6.6 Accounts and sign-in

- Require an account only if core features need it. Explain the benefit in the sign-in view, and delay sign-in as long as possible: browse first, sign in to buy (PAT-2).
- Offer Sign in with Apple; otherwise prefer passkeys (with two-factor authentication if passwords remain). Tag fields for AutoFill (username, new password, one-time code). Name the method ("Sign In with Face ID") only if the device has it, and never call an account password a "passcode".
- **Sign in with Apple** prefers the system-provided button (black, white or white with outline; "Sign in", "Sign up" or "Continue with Apple"), no smaller or less prominent than other sign-in buttons and visible without scrolling. A custom button is allowed only as the HIG's "Creating a custom Sign in with Apple button" describes: Apple's logo artwork, black or white only, one of the three titles. It's the one sanctioned Apple logo in your UI (SKILL.md); never draw the logo yourself.
- If people can create an account in the app, they can start deleting it in the app, through a clear path rather than a buried one, and deletion means deletion, not deactivation. Say when deletion completes (HIG; App Review 5.1.1(v)).

### 6.7 Notifications

- Content, grouping, interruption levels (SYS-11) and Lock Screen privacy (SYS-12) are owned by system-experiences.md.
- Here: ask per PAT-2, after the first action that benefits, or start with quiet provisional delivery; a priming screen follows PAT-5. Never block the app on notification permission.

### 6.8 Launch

**PAT-6** Launch straight into content. The launch screen is nearly identical to the first screen (its bars and background) in the current orientation and appearance, with no text, logo or splash look; it isn't a branding moment. Launch screens apply to iOS, iPadOS and tvOS only.

- Restore state: the tab, scroll position, selection and windows people left.
- Nothing stands between launch and the app: no sign-in wall, permission prompt, rating request or what's-new sheet unless essential (PAT-2). Web: render the first screen's skeleton, not a spinner page.

### 6.9 Share

- Use the system share sheet from a Share button with the standard symbol (`square.and.arrow.up`), in the toolbar or a context menu; never a custom grid of share targets.
- Add app-specific activities only for actions the system doesn't offer, each with a symbol and a short verb title.
- Web: `navigator.share()` opens the same system sheet in Safari; fall back to Copy Link where it isn't supported (web.md).

### 6.10 Charts

- Native: Swift Charts. One message per chart; pick the mark for the question (bars compare, lines show trends); label axes with units; keep gridlines light.
- Color: system colors per series, consistent across charts. Never rely on color alone; add labels, symbols or patterns (COL-2), and give marks the graphics contrast in CON-1.
- Accessibility: every series and key mark gets a label and value in words, with units, plus a one-sentence summary of the takeaway; Swift Charts exposes marks to VoiceOver and Audio Graphs. Web: a text summary or data table beside the chart (web.md).

### 6.11 Page controls

- For a flat, ordered set of pages (onboarding, a photo set); not for hierarchy or unrelated screens (use tabs).
- Centered at the bottom, with the current page highlighted; people tap either side or scrub to move. More than about 10 dots can't be counted at a glance, so switch to other navigation.
- Custom indicators: simple one-color symbols. The control's hit region, not each dot, meets HIT-1.

### 6.12 Ratings and reviews

- Only the system rating prompt, which limits itself to three times in 365 days; custom review prompts aren't allowed (App Review 5.6.1).
- Ask after people show engagement, at a natural pause such as a finished task; never at launch or mid-task (PAT-2).
- Offer a persistent Write a Review link (in settings or About) that opens your App Store page.

## Part C: Recipes and specs

## 7. Screen recipes

Common to all: floating bars sit in the safe areas, content runs edge to edge beneath them, nothing is painted behind bars, and scroll edge effects replace dividers. Code: swiftui.md (full example app) and web.md.

### 7.1 iPhone home / root screen

```
+---------------------------------+
| status bar                      |
| Title (large)      [ + ][ ... ] |  glass toolbar groups (CMP-4)
|  [ hero / featured card      ]  |  content layer, system margins
|  Section header       See All > |
|  [card][card][card] ->          |  horizontal scroller
|  inset-grouped list rows        |  CMP-7 metrics
|   :                             |  content scrolls under the bars
| ( Home  Library  Cart ) (Search)|  floating glass tab bar, 62 pt
+---------------------------------+
```

Recipe: a tab bar with a few tabs (at most five, §2.1) plus a search tab; each tab has its own navigation stack and a large title; minimize on scroll is optional. The primary action is a trailing toolbar button (plus), not a floating action button; float a glass button only when CMP-3 allows it, attached to the bottom safe area. Search: bottom toolbar or search tab (CMP-6).

### 7.2 iPhone detail screen

```
+---------------------------------+
| (<)                  [share][:] |  Back + grouped glass buttons
| full-bleed hero image           |  extends under the top bar
|  (automatic scroll edge effect) |
| Title (bold, leading)           |
| metadata / secondary text       |
| [    Primary action (filled)  ] |  opaque in content (CMP-3)
| grouped sections / list rows    |
+---------------------------------+
```

Recipe: a pushed view with an inline title; the tab bar stays unless the flow is modal. Toolbar: Back, Share, a More menu for overflow actions, and a favorite toggle as a symbol. The in-content primary action is a filled capsule (CMP-3); over a full-bleed hero it may be glass prominent. Editing opens a sheet with Cancel and Done (CMP-5). Delete lives in the More menu and is confirmed by a dialog anchored to its source (§3.4).

### 7.3 Settings screen

```
+---------------------------------+
| Settings (large title)          |
| +-----------------------------+ |
| | (icon) Account           >  | |  inset grouped (CMP-7)
| +-----------------------------+ |
| | Notifications        [ o ]  | |  switch only in rows
| | Sort By             Date v  | |  menu picker
| +-----------------------------+ |
| footer explanatory text         |
| [ search (bottom, capsule)    ] |  when the list is long
+---------------------------------+
```

Recipe: §6.2. Presented as a sheet, it gets Done trailing.

### 7.4 iPad / Mac sidebar app

```
+----------+----------------------------+-----------+
| (glass   | title   [tools]   [search] | inspector |
| sidebar) |----------------------------| (glass)   |
| Library  | content list / canvas      | props     |
|  Inbox   | (hero art runs under the   |           |
|  Recent  |  sidebar via the background|           |
| Tags  v  |  extension effect)         |           |
+----------+----------------------------+-----------+
```

Recipe: a split view with two or three columns, or a sidebar-adaptable tab view on iPad. The sidebar has two levels at most, with SF Symbols. Window toolbar: navigation and title leading, tools in the center, search, inspector toggle and the primary action trailing (CMP-4, CMP-6). On Mac every toolbar item has a menu command, and settings open in a ⌘, window. Custom panels use concentric corners (GL-6). The sidebar hides and shows from a toolbar button and the View menu; the inspector sits trailing and becomes a sheet in compact width.

### 7.5 Platform adjustments

| Platform | Adjustments                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| watchOS  | Vertical lists; full-width capsule buttons; toolbar buttons in the corners with automatic glass; one primary action; full-screen sheets with a Cancel symbol; vertical paging; minimal text entry.                                                               |
| visionOS | Its own glass (the 26 glass APIs aren't available); a vertical tab bar on the leading edge; toolbars and ornaments along the bottom; HIT-1 targets; centered sheets; no vertical toolbars.                                                                       |
| macOS    | Dense controls (mini to medium rounded rectangles), capsule large and X-Large for standout actions; a hard scroll edge under text-heavy toolbars; sidebars floating (26) or edge to edge (27); few menu-bar icons (27); every toolbar item also in the menu bar. |

## 8. Spec template (PAT-1)

**PAT-1** Specify every element of a design spec, mockup or redline with these ten fields, so an engineer can build it natively without guessing and a reviewer can cite rules. Copy the first two columns as the template; the third is a worked example.

| Field               | What to write                                                                | Example: floating "Start Cooking" button                                                 |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Element             | What people see                                                              | "Start Cooking" button over the recipe list                                              |
| HIG component       | Component and style                                                          | Button, glass prominent style, floating (CMP-3)                                          |
| Size (pt)           | Visual w×h, hit region (HIT-1), margins (LAY-2)                              | Large capsule, 50.3 tall, full width minus the system margins                            |
| Text style          | Dynamic Type style and weight (TYP-1)                                        | Headline                                                                                 |
| Color role          | Semantic role (COL-1), never hex; label on a fill per COL-3                  | App tint on glass; label per COL-3                                                       |
| States              | Normal, pressed, focused, selected, disabled, busy (FB-3)                    | Pressed (system); disabled until a recipe is chosen; busy with a spinner and "Starting…" |
| Motion              | Transition and spring preset (MOT-2), plus the Reduce Motion variant (MOT-5) | Zooms into the cooking sheet (MOT-4); cross-fade with Reduce Motion                      |
| Accessibility label | Label, value, traits, hint                                                   | "Start cooking"; hint "Opens step-by-step mode"                                          |
| Platform variant    | What changes on iPad, Mac, Watch, Vision Pro                                 | iPad and Mac: a prominent trailing toolbar item (⌘-Return on Mac)                        |
| Rules               | The rule IDs the element satisfies                                           | CMP-2, CMP-3, GL-3, GL-5, HIT-1                                                          |

Start mockups from Apple Design Resources, the official UI kits for Figma and Sketch (developer.apple.com/design/resources), instead of redrawing system components, and draw every state in light and dark.

## 9. Sources

- Apple HIG, developer.apple.com/design/human-interface-guidelines/, retrieved 2026-09-30: tab bars, toolbars, sidebars, split views, inspectors, sheets, alerts, action sheets, menus, popovers, buttons, search fields, toggles, sliders, segmented controls, steppers, pickers, text fields, progress indicators, lists and tables, collections, scroll views, modality, materials, layout, loading, onboarding, settings, launching, managing accounts, privacy, Sign in with Apple, activity views, charting data, page controls, ratings and reviews.
- Adopting Liquid Glass: developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass.
- WWDC25 (developer.apple.com/videos/play/wwdc2025/): 356 Get to know the new design system; 323 Build a SwiftUI app with the new design; 284 Build a UIKit app with the new design; 310 Build an AppKit app with the new design.
- WWDC26 (developer.apple.com/videos/play/wwdc2026/): 102 Platforms State of the Union; 269 What's new in SwiftUI; 278 Modernize your UIKit app; 289 Modernize your AppKit app; 292 Design intuitive search experiences.
- Measured metrics: iOS 26.3 Simulator probes of UIKit and SwiftUI controls (2026-09-30). Button-style names checked against the iOS 26.2 SDK.
- App Store Review Guidelines 5.1.1 (data access, account deletion) and 5.6.1 (App Store reviews): developer.apple.com/app-store/review/guidelines/.
