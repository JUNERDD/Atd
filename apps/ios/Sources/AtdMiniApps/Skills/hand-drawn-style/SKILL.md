---
name: hand-drawn-style
description: Atd's Notion-style hand-drawn look for the pages of mini apps (ink on paper, edges drawn by hand, color only as highlighter, ink line illustrations). It applies whenever a mini app's page is built or changed, so the page reads as part of Atd. It governs how the page looks, not its data, its behavior or its widget, and it gives way to a look the person asks for.
---

Atd is drawn by hand, in the manner of Notion-style ink drawings: dark ink on white paper (light ink on charcoal in dark mode), every edge a pen line that strays a little around corners rounded unevenly, color laid on only as highlighter, and here and there a line illustration. A mini app's page sits inside Atd, so it is drawn in the same hand: going from Atd's own screens into the app must not feel like entering another product. The kit already draws its classes this way; the rules below keep everything else on the page in the same hand. When the person asks for a look of their own, give it to them within this hand where you can (a pink app gets pink highlighter; a calmer page gets fewer marks), and leave the hand only as far as their request goes.

## The kit

- Text: .title, .kicker (a small label), .big (the one large number, with <small> inside for its unit), .sub (a secondary line), .meta. Layout: .stack (a spaced column), .row-between.
- section.card: a block that groups its own content, outlined by hand with no fill. One per block, never one per row.
- ul.list > li > .row: plain rows on the paper with straight hairlines; .grow for the text, .end for a value at the end. A .row with role="checkbox" and aria-checked holds a .check-box (a tick box).
- button.btn (an inked outline), .btn.primary (solid ink: the screen's one main action), .btn.hl (highlighter), .btn.block (full width), .btn.round (an icon button; give it an aria-label). label.field-frame > input.field (a text field; inputmode="decimal" for numbers). .segmented > label > input[type=radio] + span (one choice of a few).
- Marks: div.ring holding atd.ui.ring(...) and a .ring-in for its label, .bars, .meter, .note (a done message on green highlighter).
- .inked: the hand-drawn edge for any other box, such as a day in a calendar, a tile or a tag. Add .on, .chosen or .hl to fill it with that highlighter, and .strong for an ink edge (today, or the one in focus). On a button it also clears the browser's own frame and nudges when pressed.
- .blob: a thing's own mark, the way Atd marks its apps: a highlighter blob, 34 points, with an <i class="sym"> inked inside.
- <mark>: words marked with highlighter.
- svg.art: an illustration, as Illustrations below describes.

## Paper, ink and highlighter

- The page is the paper. Never give the page, a section or a card a background, and never add shadows, gradients, blur, glass or see-through layers.
- Text and lines are ink: var(--ink), var(--ink-2) for secondary text, var(--ink-3) for the faintest; edges are var(--line), card edges and hairlines var(--card-line). Never write a literal color: the tokens follow light and dark mode.
- Color appears only as highlighter on the paper, and only to say something: var(--on) (green) for done and on, var(--chosen) (yellow) for the chosen option, var(--hl) (the app's own) for its marks: progress, today, the one thing the page is about. var(--hl-<tint>), where tint is one of red orange yellow green mint teal cyan blue indigo purple pink brown gray, tells kinds of things apart; to give an element another tint's highlighter, set --hl on it: style="--hl: var(--hl-mint)". Text on highlighter stays ink. Nothing is colored to decorate.

## Lines, type and icons

- Every edge is a hand-drawn line, from the kit's classes or .inked. Never draw an edge with border, outline or box-shadow, and never give a box your own even border-radius: it stops looking drawn.
- Emphasis comes from size and weight in ink, not from color: one .big number, a .title, .kicker labels, .sub and .meta for the rest. Size text with the kit's classes, font-size or font-weight. Never set font or font-family and never use a handwriting or display font: the kit's fonts follow the person's text size and draw Chinese, and the hand shows in the lines, not in the letters.
- Icons are symbols inked in the text's color: <i class="sym" data-name="…">. Prefer outline symbols (names without .fill), since Atd's glyphs are lines. No emoji or colored pictures as decoration; the person's own entries keep whatever they typed.
- Leave the paper open: the kit's gaps, content grouped by meaning, nothing boxed that does not need a box. Motion stays quiet: the kit's press nudge and short eases, never anything that bounces, loops or celebrates on its own.

## Illustrations

Atd's own screens open with spot illustrations: Notion-style ink line drawings, simple and friendly. A page may carry one where it has a moment to mark and room for it: before anything is in the app, which is how every new app first opens, or when something is finished. It shows at a glance what the app is about. It never carries information, never decorates rows, cards or buttons, is never more than one on screen, and never pushes what the person came to do out of view. Leave it out when the page has no such moment or no room.

Draw it inline as <svg class="art" viewBox="0 0 160 112" aria-hidden="true">. Each child (path, circle, ellipse, rect or line) is a mark drawn over the ones before it, with at most one of the classes below. The kit inks and fills the marks in light and dark mode, so never set fill, stroke, color, opacity or style on them:

- no class: the ink line, 2 units wide with round ends: outlines, the ground, a smile, an arm.
- thin: a finer line for inner detail: folds, lines of text, rays, motion ticks.
- paper: a closed shape filled with paper and outlined in ink. Every solid thing is paper, so it covers what was drawn before it: that is how things overlap.
- deep: a closed shape filled with the darker gray: the shaded side of a box, an inside, a hole.
- ink: a small solid shape: hair, eyes, buttons, sparkles.
- shade: one soft, irregular blob behind the whole scene, drawn first, without a line.

Draw in the hand of Atd's own illustrations. One subject in the middle, 40 to 70 units tall, built from simple shapes with round ends, standing on a long, slightly uneven ground line near y 104 when it stands on something. One small thing floats beside it and tells the story: a bubble, a heart, a moon, a cube. Two or three ink sparkles of different sizes (four-point stars: M x y-s Q x y x+s y Q x y x y+s Q x y x-s y Q x y x y-s Z) and perhaps a few thin ticks fill the empty corners. A box shows its depth with a paper top and a deep side, slanted alike. Draw a person when a person tells the story better than a thing: an oval paper head, hair as one ink shape, dot or arc eyes, a small smile, a rounded paper body and hands as small paper ovals; no fingers, no detailed clothes, nobody real. Use ink, paper and the two grays only: no tint, and no text, letters, numbers or logos. Keep to about 12 to 30 marks and 2 KB, with whole numbers or one decimal; marks of one class drawn one after another may share a path.

Put it with what it belongs to, centered: in the card the content will fill, over a short label such as "No pages yet", hidden once there is content; or beside a done note. The kit draws it at most 150 points wide; inside a card it may be smaller (width: 120px).

The reading app's empty state, a person with an open book, shown in the streak's card until pages are logged:

<svg class="art" viewBox="0 0 160 112" aria-hidden="true">
<path class="shade" d="M18 78C14 50 44 26 82 26C120 26 148 48 144 78C140 102 110 112 78 110C44 108 22 102 18 78Z"/>
<path class="paper" d="M46 110C46 90 60 80 80 80C100 80 114 90 114 110Z"/>
<path class="thin" d="M72 81Q80 88 88 81"/>
<path d="M75.5 68V80M84.5 68V80"/>
<path class="paper" d="M66.8 55C63 54 63 61 67.2 61"/>
<ellipse class="paper" cx="80" cy="54" rx="13.5" ry="15"/>
<circle class="ink" cx="91.5" cy="38.5" r="5"/>
<path class="ink" d="M66.6 54.5C65 40 72 34 81 34C90 34 95.4 40 93.6 52.5C90.5 47 86.5 45 82 46C78 44 74 45 72 48.5C70 50 68.2 52 66.6 54.5Z"/>
<path d="M72.6 57Q75.2 54.4 77.8 57M82.2 57Q84.8 54.4 87.4 57M76.6 63Q80 66 83.4 63"/>
<path class="deep" d="M58 104C66 102 74 103 80 106C86 103 94 102 102 104V107C94 105 86 106 80 109C74 106 66 105 58 107Z"/>
<path class="paper" d="M80 92C74 88 66 87 58 88V104C66 102 74 103 80 106ZM80 92C86 88 94 87 102 88V104C94 102 86 103 80 106Z"/>
<path class="thin" d="M63 93C67 92.3 71 92.7 75 94M85 94C89 92.7 93 92.3 97 93M63 97.5C67 96.8 71 97.2 75 98.5M85 98.5C89 97.2 93 96.8 97 97.5"/>
<path d="M49 104C53 105.5 55.5 104 57 101M111 104C107 105.5 104.5 104 103 101"/>
<ellipse class="paper" cx="59" cy="99" rx="4.4" ry="5.4"/>
<ellipse class="paper" cx="101" cy="99" rx="4.4" ry="5.4"/>
<path d="M24 110C56 108.5 104 110.5 136 109"/>
<path class="paper" d="M131 22A11 11 0 1 0 140 40A9 9 0 0 1 131 22Z"/>
<path class="ink" d="M24 41.6Q24 46 28.4 46Q24 46 24 50.4Q24 46 19.6 46Q24 46 24 41.6ZM36 23.2Q36 26 38.8 26Q36 26 36 28.8Q36 26 33.2 26Q36 26 36 23.2ZM144 58.6Q144 62 147.4 62Q144 62 144 65.4Q144 62 140.6 62Q144 62 144 58.6Z"/>
<path class="thin" d="M118 30L114.5 28M119 38L115 38.5"/>
</svg>

## Changing a page

Keep the page's look as it is. Draw whatever you add in this hand; restyle an existing part only when the change is about it, and then in this hand. Keep an illustration exactly as it is unless the change is about it.
