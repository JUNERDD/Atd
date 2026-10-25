# Designing a view: its widget and its window

These are the project's Apple design rules (the Human Interface Guidelines of the Liquid Glass era), narrowed to what a view needs in a macOS app. A view has two surfaces, both on the host's glass and in the app's appearance: the widget, a glance inside a card in the conversation, 320–640 px wide (the kit's compact width band) and at most 240 px tall; and the window, the whole view in a window of its own that the user opens from the widget. `kit.md` has the markup of every block; this file says which ones to use and how. These rules keep views consistent and accessible, not identical: within them each view takes its form, accent and rhythm from its own subject and data (`SKILL.md`, workflow step 3).

## Layout

- **Purpose first.** What the user does or reads first takes the first position (the top, then the leading edge) and the most room; supporting text is smaller and secondary. Group by meaning with space and alignment, and use a list section or a card only where a group means something.
- **Form from the data.** Choose the primary visual by the shape of the data and what the user does with it, not by habit: tiles or columns to compare a few options, a chart for change over time or for parts of a whole, steps or a timeline for a sequence, rows to scan, sort or triage many items, a gauge, a ring or a large figure for one quantity, previews side by side to choose a look, a grid of thumbnails for images. Lists and cards are one answer among these. Keep one primary visual per surface, and draw what no kit block covers with inline SVG and CSS on kit tokens.
- **Margins and spacing.** Each root carries its margins, by default the kit's `padding: var(--space-4) var(--margin-page)` (16 px, and 20 px from 440 px wide). Set them on purpose when the content asks: tighter for dense data or many small tiles, more open around a single focal element, none on the side where an image or a chart should run to the edge. Space with the `--space-*` tokens (4, 8, 12, 16, 20, 24, 32 px …): smaller gaps inside a group than between groups. Separate groups with space, not lines or shadows. A list inside the padded root takes `.list--flush`, so it does not add a second inset.
- **Adaptive width.** Break long names, paths and URLs (`overflow-wrap: anywhere`), and leave room for translations twice as long. Rows wrap (`flex-wrap`) and tiles reflow (`grid-template-columns: repeat(auto-fit, minmax(…, 1fr))`); nothing scrolls sideways. Use logical properties (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`), never `left` and `right`, so right-to-left text mirrors.
- **No second title.** The host shows the title above the widget and in the window's title bar; start each surface with its content, or with one line saying what to do when that is not obvious.
- **Transparent pages.** The host's glass shows through both pages: give neither a root nor `body` a background.

### The widget

- **A glance.** It answers what is in the view and whether it needs the user, read in a second before the user clicks it to open the window. Choose the form that answers this for this view's data, and let it differ from view to view as the data does: a large figure with its unit and what it means; a ring or a bar of progress with what remains; a sparkline or a few bars with the takeaway beside them; a row of status chips counting the items in each state; the first rows of a list with their key value; a strip of thumbnails or swatches; two values side by side for a comparison. It renders from `data`, so `update_ui` keeps it current.
- **No controls.** Clicks on the widget open the window, so it holds no buttons, fields, links or anything else that looks clickable on its own, and nothing in it takes focus.
- **Compact and short.** Design at 320 px wide and check at 640; one column, a row that wraps, or two or three tiles side by side. The frame takes the content's height from 32 to 240 px and cuts off the rest: aim for 80 to 200 px, cap lists at three or four rows with a "+ 5 more" line, and use no `vh` units, `position: fixed` or scrolling.

### The window

- **A focused tool.** One purpose, the one the user opened it for. The host draws the title bar (52 points, with the window controls and the view's title) above your document, so add no title bar, toolbar, navigation bar or tab bar of your own; switch between regions with a segmented control, and reveal detail in place: `<details>`, a row that expands, or the kit's `menu` popover.
- **Fill the window.** The document gets the whole area under the title bar and follows it as the user resizes, from 320 × 240 points up. The window opens at the size you ask for in `window`, title bar included, or 560 × 640 points: choose one that fits the content without scrolling when you can. `100vh` is the document's own height, so a full-height layout works. When the content is taller, the document scrolls as a whole; keep each action right after the content it acts on.
- **Widths.** Lay it out for the width you open it at, and check it at 320 points, where everything stacks into one column with labels above their controls. As the window widens, use the room the content can use: a list beside its detail, a grid of tiles or previews, a chart with its legend or controls beside it. Add columns rather than stretching lines of text past about 70 characters.

## Material

- Both surfaces stand on the host's surface: Liquid Glass under a slightly translucent fill, the material of Atd's own windows (the screen-sharing monitor, the task panel), opaque when the user turns on Reduce Transparency and in the app's light or dark appearance. The widget stands on its card in the conversation, the window on its own window. That surface is the view's only glass.
- Content sits on it in the kit's fills: lists, rows, cards, tiles and charts take `.list`, `.card`, `--fill-*` or `--secondary-system-background`, never glass, blur or `backdrop-filter`, which would stack glass on the host's glass.
- Glass belongs only to a control floating over media inside the view, such as a play button on an image: `.btn-glass` or `.glass`, two or three at most, never glass on glass, never a hand-written `backdrop-filter`. Buttons in content are opaque: `.btn-filled`, `.btn-bordered`, `.btn-tinted`, `.btn-plain`.
- Shapes are capsules (the kit's buttons, segmented controls and switches) or concentric: an inner radius is the outer radius minus the padding between them (`.concentric`, or `calc()` from the parent's radius). Separators are hairlines in `--separator`; content casts no shadows.

## Type

The host sets `data-platform="macos"`, so the `.t-*` classes give the macOS text styles:

| Class                        | Size / line height (px) | Weight          |
| ---------------------------- | ----------------------- | --------------- |
| `.t-large-title`             | 26 / 32                 | Regular         |
| `.t-title1`                  | 22 / 26                 | Regular         |
| `.t-title2`                  | 17 / 22                 | Regular         |
| `.t-title3`                  | 15 / 20                 | Regular         |
| `.t-headline`                | 13 / 16                 | Bold            |
| `.t-body` (the default)      | 13 / 16                 | Regular         |
| `.t-callout`                 | 12 / 15                 | Regular         |
| `.t-subheadline`             | 11 / 14                 | Regular         |
| `.t-footnote`                | 10 / 13                 | Regular         |
| `.t-caption1`, `.t-caption2` | 10 / 13                 | Regular, Medium |

- Build hierarchy with size and weight (`.t-emph` gives a style's emphasized weight); titles are bold and leading-aligned. Never all caps, never lighter than Regular for text, nothing smaller than `.t-caption2`.
- Size text with the classes or the `--fs-*` and `--lh-*` tokens, never pixel font sizes, so it scales with the user's settings.
- Use only the kit's system fonts: `--ff-sans`, `--ff-rounded` for a friendly number, `--ff-serif` for long reading, `--ff-mono` for code. No web fonts.
- Numbers that change or line up take `font-variant-numeric: tabular-nums`. A hero number may take `.t-title1` or `.t-large-title`.

## Color and contrast

- Every color is a token. Text: `--label`; `--secondary-label` for supplementary text; `--tertiary-label` only for hints and the disabled look. Lines and fills: `--separator`, `--fill`, `--fill-secondary`, `--fill-tertiary`, `--fill-quaternary`. Hues: `--system-red` … `--system-brown`, with `--on-red` … for text or a glyph on that hue. Accent: `--accent` for fills, tints and selection indicators, never text; `--accent-text` for accent-colored text; `--accent-fill` with `--accent-on` for a filled control; `--focus-ring`. Links: `--link`. Tones: `--state-error`, `--state-warning` and `--state-success` color icons and borders, never text. A literal color appears only in content that is itself a color, such as a swatch.
- The host puts `data-theme="light"` or `"dark"` on the document and changes it live. Tokens and `light-dark()` follow it; `@media (prefers-color-scheme)` follows the system instead and can disagree, so never use it, and never offer an appearance switch. A canvas drawing resolves a token by reading the computed `color` of an element that uses it, and redraws on `atd:context`.
- **The view's accent.** One accent per view, chosen from the system hues by its subject and set on `--accent` at the root of both surfaces (`runtime.md` shows how); the default blue is right when nothing suggests another hue. In the window it marks what is interactive. In the widget, which is one control as a whole, it may carry the glance's key mark: a ring, a bar, or the figure itself in `--accent-text`. Don't spend it on decoration, and don't replace it with a literal brand color, whose contrast on the glass you cannot check. Color never carries meaning alone: add a word, a symbol or a shape (a checkmark on the chosen option, an icon and words on an error).
- Contrast: text at least 4.5:1, since only text of 24 px, or 18.66 px bold, may drop to 3:1; icons, chart marks and control edges at least 3:1. Text and glyphs on a hue fill take its `--on-*` color: white fails on yellow, orange, green, mint, teal and cyan.
- Charts: one message per chart; bars compare, lines show change over time; one `--system-*` hue per series, the same hue for the same series everywhere; axes labeled with units; light gridlines. Give the takeaway in a sentence and the values in text (labels beside the bars, or a table), because color and shape don't reach everyone.

## Controls and blocks

Choose by what the user does in the window; the widget has no controls. The service adds `base`, `type`, `type-macos` and `states` to both surfaces; name the rest in `blocks`.

| The user…                        | Use                                                                                                                                        | Blocks                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| takes the main action            | `.btn-filled`, once per window, last among the actions                                                                                     | `button`                            |
| takes another action             | `.btn-bordered`, `.btn-tinted` or `.btn-plain`; add `.btn-destructive` to an action that deletes, which is never the filled one            | `button`                            |
| turns a setting on or off        | `.switch` in a `.list__row` whose label names the setting                                                                                  | `list`, `switch`                    |
| picks one of two to five options | `.segmented`, with noun labels, all text or all icons                                                                                      | `segmented`                         |
| picks one of many options        | a native `<select>` with a `<label>`: the system draws its menu outside the frame, so nothing cuts it off                                  | none                                |
| sets a number in a range         | `.slider` with the value shown beside it, or `.stepper` next to its number field                                                           | `slider`, `stepper`                 |
| types text                       | `.field` with a visible `.field__label` and the right `type`, `autocomplete`, `inputmode` and `enterkeyhint`; a placeholder is only a hint | `field`                             |
| scans rows of items or settings  | `.list` with a title and subtitle per row, a trailing value, and a chevron only when the row opens something                               | `list`                              |
| reads a grouped summary          | `.card`: opaque, with one tap target and at most one other control                                                                         | `card`                              |
| chooses between visual options   | `<button>` tiles holding an inline SVG preview, a name and a line of description, with `.pressable` and a `background-color` fill          | none: `.pressable` is in every view |
| waits for something              | `.progress` when the amount is known, otherwise `.activity-indicator` beside a label that names the task, or inside the busy button        | `progress`, `motion`                |
| needs a count or a status        | `.badge`, or a `.field-message` line                                                                                                       | `badge`, `field-message`            |
| finds nothing there              | `.empty-state`: a symbol, why it is empty and the next step                                                                                | `empty-state`                       |

In the window, `menu` gives a pull-down of secondary actions or a popover of detail, which open inside the window. Not in a view: `tabbar`, `toolbar`, `navbar`, `sheet`, `alert`, `status-pill` and `scroll-edge` belong to app chrome the host already draws, or to modal layers that would hide the window behind glass of their own.

- **Hit regions.** Every control's hit region is at least 44 × 44 px (`--hit`), as the kit's controls are. A smaller custom control takes `.hit-extend` (a transparent extension that leaves the layout alone) or `.hit-44`. Keep about 12 px around bordered controls and 24 px around borderless ones.
- **Placement.** Actions follow the content they act on, the primary one trailing; at 320 px let them wrap or take the full width (`.btn-block`). One prominent action per window, since a second filled button competes with the first; tell a pair of choices apart by style, not size.
- **Labels.** Buttons start with a verb ("Export 24 Photos", "Compare Plans"). An icon-only button is only for a familiar symbol, and has an `aria-label`.
- **Waiting views.** Add no Cancel or Skip button: the composer offers Skip, and the user can answer there too.

## States and feedback

- Kit controls carry their pressed, hover, focus, selected, disabled and busy states. A custom control gets them from `.pressable` (give it a `background-color` fill), the kit's focus ring, and ARIA: `aria-pressed`, `aria-checked`, `aria-selected`, `aria-current`, `aria-expanded`. Hover styles only inside `@media (hover: hover) and (pointer: fine)`, and nothing essential behind hover.
- A disabled control stays visible, dimmed and inert, with the reason nearby ("Select photos to move them to the Trash"). A busy control keeps its focus: `aria-busy="true"` with `aria-disabled="true"` (not `disabled`), an `.activity-indicator` inside it with `--motion-delay: 400ms` so quick results don't flash it, a label that says what is happening ("Moving…"), and no second submit.
- Confirm outcomes in place: the result itself (a row disappears, a value changes) or a short status line; no toasts, alerts or success dialogs. Errors go next to their cause, in words that say how to fix it, with `aria-invalid="true"` on the field and a `.field-message` with `data-tone="error"`; never a red border alone, and never just "Error".
- Design the real states, not only the full one: empty says why and what to do next; loading names the task ("Reading 12 files…"), never "Loading…"; an error says what happened and what the user can do.
- Announce what arrives without moving focus, such as new data or a refused send: `AppleFeedback.announce(text)`, or an `aria-live="polite"` region that stays in the page.

## Motion

- Motion explains a change (a value updating, a selection moving, something appearing) and stays brief. Nothing decorative, nothing that loops, nothing the user waits for; one primary motion at a time.
- Use the kit's springs: state changes on `--dur-spring-snappy` with `--spring-snappy`, without visible bounce; larger moves on `--dur-spring-smooth` with `--spring-smooth`. Kit controls already press in on `--dur-press` with `--curve-out`.
- Animate only `transform` (or `translate`, `scale`, `rotate`) and `opacity`; never width, height, position, blur or `backdrop-filter`.
- Something that appears grows from its source with `.motion-pop` (set `--motion-origin`), or fades in with `.motion-fade`. A group may stagger with `.motion-stagger` and `--motion-index`, 150 ms in all at most. A changing number keeps tabular figures and cross-fades briefly. A selection indicator slides; it never fades.
- Reduce Motion: kit blocks substitute fades on their own. Give your own motion a `@media (prefers-reduced-motion: reduce)` substitute, a fade of about 0.2 s with no movement or scale, or check `AppleMotion.reducedMotion()` in script; keep state changes, progress and spinners.

## Writing

- Write every word in the language the user writes in, with `lang` on the root, which also drops Latin letter spacing for Chinese, Japanese and Korean, and `dir="rtl"` for Arabic or Hebrew.
- Be concise, plain and active; no jargon, idioms or jokes that don't translate. Say "click", as on a Mac. Buttons are verbs; describe a setting by what it does when it is on.
- English capitalization: title style for buttons, segment labels and section headers ("Move to Trash", "Last 30 Days"); sentence style for descriptions, hints and status lines. Chinese and Japanese have no case: keep Latin names as written, use full-width punctuation, and put a space between CJK text and Latin words or numerals.
- An error sits next to the problem, blames no one and says how to fix it ("Enter a size from 256 to 8,192 pixels."). An empty state says why and what to do next.
- Format numbers, dates, currencies and units with `Intl` (`Intl.NumberFormat`, `Intl.DateTimeFormat`, `toLocaleString`) in the view's language; never assemble them from strings.

## Icons and images

- Icons are inline SVG line icons from one consistent style, matched in weight to the text beside them (a stroke of about 1.75–2 px at 24 px), with `stroke="currentColor"` so they follow the text color, contrast settings and appearance, and optically centered. Mark an icon `aria-hidden="true"` when words beside it say the same.
- No SF Symbols artwork, Apple logos, or device frames that imitate Apple products; draw generic shapes.
- Images are inline SVG or `data:` URIs with explicit `width` and `height`, so nothing jumps. A meaningful image has `alt` text, a decorative one `alt=""`, and no image carries text that should be words.

## Accessibility

- Native elements first: `<button>`, `<a href>`, `<input>`, `<select>`, `<textarea>`, `<label>`, `<fieldset>` with `<legend>`, lists, `<table>` for tabular data, headings in order. ARIA only for what HTML lacks.
- Every control has a name, and its visible label matches that name. Group related controls in a `<fieldset>` with a `<legend>`, or in `role="group"` or `role="radiogroup"` with an `aria-label`.
- Keyboard: every pointer action has a keyboard path (Tab, Enter, Space, and arrow keys within a radio group), and no focus outline is removed without the kit's ring in its place. The host moves focus into the window's document when the window opens, so the first Tab reaches your first control; don't use `autofocus` or call `focus()` on load. The widget never takes focus: the host's card is what the keyboard reaches, and its name is the view's title.
- State is never only visual: it is in ARIA attributes and in words. In forced colors, a custom control carries its state in a border, a symbol or text, not only in a background or shadow.
- Before showing a view, walk through the widget at 320 and 640 px wide and the window at 320 × 240 points, at its opening size and wider, in light and dark, with Reduce Motion, with text twice as long, and with empty and error data.
