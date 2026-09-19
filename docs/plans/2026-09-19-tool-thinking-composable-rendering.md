# tool-thinking-composable-rendering

Status: Done - full checklist executed 2026-09-19
Created: 2026-09-19
Approval: Approved by user 2026-09-19 - full checklist

## Summary

The thinking row (`已思考 5s`) and tool row (`列出命令` + `已完成`) in the screenshot share only the low-level affordance: transcript-local `CollapsibleRow` wrapping generic Radix `Collapsible` + ghost `Button` from `@ai/ui`. Everything that makes them read as one tree — row anatomy (icon/title/meta/status), phase header/body/rail, open-state ownership, status vocabulary, and the JSON detail body — is bespoke feature-local markup and CSS under `apps/desktop/src/features/agent/transcript/`.

`ThinkingBlock` owns `useState(false)` and builds its summary from `tasks` i18n + `formatElapsed(durationMs)`; redacted reasoning bypasses `CollapsibleRow` with a plain `div`. `ToolBlock` owns `useState(forceOpen)` with `expanded = forceOpen || open`, builds heading from `tool-copy` keys/icons, and renders `ToolBody` which for `command:list` is a verbatim `<pre>` of `JSON.stringify(value, null, 2)` — not a tree view. `ActivityPhaseView` is a separate bespoke expandable (`Button` + `div.phase-body[data-open]` + `ScrollArea`, CSS rail), not Radix-backed and not reusable. `已停止` in the screenshot footer is run-level `RunStatus` in `StatusBar` (plus an inline `conversation.stopped` when `stopReason=aborted`), not a tool status.

The fix is to introduce two feature-local composable contracts under `features/agent/transcript/` following the repo `ContextBubble` precedent and the composable-components house rules: (1) a state-owning row/tree contract (`Root` with throwing context `state/actions/meta`, transparent host parts `Root/Trigger/Content/Icon/Title/Meta/Body` or equivalent, `open/defaultOpen/onOpenChange` + `data-slot/data-state/data-status`, `asChild` via `Slot.Root`, no `child.type` scanning, barrel-only imports, `_`-folder layout) for phase → steps → thinking/tool rows; (2) a structured JSON tree contract for tool output payloads (not verbatim `<pre>`), with safe parse + verbatim fallback. Locked decisions from 2026-09-19: scope covers both timeline and JSON; owner stays feature-local; list markup is the default (no ARIA tree unless required).

## Clarifying Questions

- [x] Scope of “树结构”: resolved 2026-09-19 as both — (a) activity timeline (phase → steps → thinking/tool rows) plus (b) JSON payload inside tool output. Verbatim `<pre>` stays only as fallback for non-JSON text or parse failure.
- [x] Ownership of the new compound: resolved 2026-09-19 as feature-local under `features/agent/transcript/`; promote to `apps/desktop/src/components/` or `packages/ui/` only when a named second consumer is identified.
- [ ] Tree semantics: `ul/li` list markup with existing expand/collapse is the recorded default; full `role=tree/treeitem` keyboard navigation stays out of scope unless you require it.
- [ ] JSON tree shape: recorded default is per-node collapse/expand + copy + line-clamped preview for long strings + safe handling of large payloads (row cap or virtualized window to be chosen during design); verbatim `<pre>` remains the fallback. Confirm if copy or large-payload behavior must differ.

## File And Code References

Current thinking path:

- `apps/desktop/src/features/agent/transcript/transcript.tsx:128-143` — `Transcript` → `TurnList` → `TurnView`.
- `apps/desktop/src/features/agent/transcript/turn-view.tsx:73-103` — `activity → ActivityGroup`, else `BlockView`.
- `apps/desktop/src/features/agent/transcript/activity-group.tsx:151-156` — phase body maps `phase.steps → PhaseStep`.
- `apps/desktop/src/features/agent/transcript/phase-step.tsx:20-21` — `thinking → ThinkingBlock`; `apps/desktop/src/features/agent/transcript/block-view.tsx:23-24` — standalone same.
- `apps/desktop/src/features/agent/transcript/thinking-block.tsx:13-23` — `ThinkingBlock`, local `open`, `elapsed = formatElapsed(durationMs)`, summary from `thinking.redacted / transcript.verb.thinkLive / thinkDone / thinking.doneWithElapsed`.
- `apps/desktop/src/features/agent/transcript/thinking-block.tsx:25-35` — redacted branch: plain `div.thinking-row`, no trigger.
- `apps/desktop/src/features/agent/transcript/thinking-block.tsx:37-55` — `CollapsibleRow` with `Sparkles` icon, `thinking-line` heading (+ `thinking-pulse` when streaming), body `StreamdownMarkdown(block.text)`.
- `apps/desktop/src/features/agent/transcript/elapsed.ts:2-9` — `formatElapsed` (`5s`, `2m 30s`).
- `apps/desktop/src/features/agent/transcript/phase-title.ts:68-77` — `思考 3 次` header counts `isThinkingView` steps; `phase-title.ts:50-58` live header.
- `apps/desktop/src/i18n/locales/en/tasks.json:101-105,172-175` and `apps/desktop/src/i18n/locales/zh-CN/tasks.json:101-105,172-175` — `thinking.*` + `transcript.verb.think*` keys.
- `apps/desktop/src/features/agent/transcript/markdown.tsx:114-171` — `StreamdownMarkdown`, streaming vs static, hardened plugins.

Current tool path:

- `apps/desktop/src/features/agent/transcript/tool-block.tsx:27-42` — `ToolBlock`, `useState(forceOpen)`, `expanded = forceOpen || open`, `Icon = toolIcon(name)`, `command → commandStepKey(args)`.
- `apps/desktop/src/features/agent/transcript/tool-block.tsx:50-78` — heading: title (+ `Shimmer` when running), `.tool-chip` vs `.activity-meta`, `.permission-chip`, `X.tool-row-error` when failed/declined/interrupted.
- `apps/desktop/src/features/agent/transcript/tool-block.tsx:79-90` — `CollapsibleRow` + `div.tool-body > ToolBody` + `ApprovalControls` when confirmation present.
- `apps/desktop/src/features/agent/transcript/tool-body.tsx:30-38` — `ToolOutput`: `ScrollArea > pre.tool-output-pre` (verbatim text, wrap-anywhere).
- `apps/desktop/src/features/agent/transcript/tool-body.tsx:40-68` — `ToolBody`: `edit → ToolDiff`, `bash → .tool-bash`, default (`command` included) → `ToolOutput` + interrupted note.
- `apps/desktop/src/features/agent/transcript/tool-body.tsx:5-28` — `ToolDiff` is edit-only, not used for `command`.
- `apps/desktop/src/features/agent/transcript/tool-copy.ts:78-89,125-127` — `ICONS` map, `command → SquareTerminal`, fallback `Wrench`; `tool-copy.ts:100-110` `commandStepKey` (`operation=list → activity.step.commandList`).
- `apps/desktop/src/features/agent/transcript/tool-copy.ts:224-285` — `outcomeKey/scopeKey/statusLabelKey` (`completed → activity.completed`).
- `apps/desktop/src/i18n/locales/zh-CN/tasks.json:39,51` — `completed=已完成`, `commandList=列出命令`.
- `apps/desktop/src/features/agent/transcript/turns.ts:30-37` + `block-view.tsx:26-32` + `phase-step.tsx:23-30` — `forceOpen = isPendingWrite` (edit/write with confirmation only; `command:list` never force-opens).
- `apps/desktop/electron/agent/worker-tools.ts:130-137,148-151` — `command` returns `JSON.stringify(value, null, 2)`; list value is `CommandSummary[]`.
- `apps/desktop/electron/agent/command-schema.ts:174-181` — `CommandSummary{id,revision,name,description}`.
- `apps/desktop/electron/agent/transcript-schema.ts:22-30,98-116` — `ToolStatus` (running/completed/failed/declined/interrupted) and tool block shape.
- `apps/desktop/electron/agent/transcript-project.ts:200-221,129-132` — `output/partial/details/status` projection.
- `apps/desktop/src/features/agent/transcript/status-bar.tsx:9-21` — footer `conversation.stopped` when run is stopped/interrupted; `apps/desktop/src/features/agent/transcript/assistant-block.tsx:43-45` — inline same when `stopReason=aborted`; `apps/desktop/electron/agent/task-schema.ts:56-69` — `RunStatus`.

Shared row + phase wrappers (the tree that is not generic yet):

- `apps/desktop/src/features/agent/transcript/collapsible-row.tsx:12-33` — `CollapsibleRow({open,onOpenChange,label?,icon,heading,children,className?})`, props-driven, no context.
- `apps/desktop/src/features/agent/transcript/collapsible-row.tsx:34-49` — `Collapsible > CollapsibleTrigger(asChild) > Button.ghost.activity-trigger > span.row-icon-swap(icon + ChevronRight) + heading` + `CollapsibleContent > children`.
- `apps/desktop/src/features/agent/transcript/activity-group.tsx:81-95` — `ActivityPhaseView`: `override`, `waiting` forces open, finished phase clears override; live pin via `useLivePhasePin`.
- `apps/desktop/src/features/agent/transcript/activity-group.tsx:100-109` — single-step bypass renders `PhaseGlyph + PhaseStep` with no header.
- `apps/desktop/src/features/agent/transcript/activity-group.tsx:127-159` — bespoke `Button.phase-trigger[aria-expanded]` + `div.phase-body[data-open] > ScrollArea.phase-scroll > div.phase-steps > div.phase-step`.
- `apps/desktop/src/features/agent/agent.css:307-435` — `.activity-trigger`, `.activity-meta/.tool-chip`, `.tool-row-error`, `[data-slot=collapsible-content]` open/closed keyframes, `.row-icon-swap`.
- `apps/desktop/src/features/agent/agent.css:505-572` — `.phase-body` grid-rows transition, capped scrolling window, phase rail via `::before/::after` + `--activity-connector`.
- `apps/desktop/src/features/agent/agent.css:587-699` — `.thinking-pulse/.thinking-line/.thinking-full`, `.tool-body/.tool-output/.tool-diff`.
- `apps/desktop/src/features/agent/transcript/adapter.ts:104-270` + `turns.ts:86-113` + `phases.ts` — `adaptTranscript`, activity folding, phase grouping consumed by the views above.

Reuse candidates + house precedent:

- `apps/desktop/package.json:38-39` — React 19.2.8; `packages/ui/package.json:22,29-37` — `radix-ui 1.6.7`, React 19 peer/dev.
- `packages/ui/src/components/collapsible.tsx:1-19` — thin Radix trio with `data-slot`, zero styling, transparent pass-through (only expandable in `packages/ui`; no accordion/tree/disclosure file).
- `packages/ui/src/components/button.tsx:42-60` — `Button({variant,size,asChild})`, `Slot.Root` host transparency, `data-slot=button`.
- `packages/ui/src/components/item.tsx:8-20,33-53,55-177` — `ItemGroup/Item(cva: default|outline|muted; default|sm|xs)/ItemMedia/ItemContent/ItemTitle/ItemDescription/ItemActions/...`, `data-slot=item-*`; unused in transcript today (only `task-files.tsx` uses it).
- `packages/ui/src/components/dropdown-menu.tsx:9-23`, `popover.tsx:5-11`, `command.tsx:17-28,160-172` — other Radix-backed `Root/Trigger/Content` precedent with `data-slot`.
- `packages/ui/components.json:3`, `apps/desktop/components.json:3` — preset `radix-rhea`, Neutral, Lucide.
- `packages/ui/src/styles.css:11-29,30-139` — `--ata-*` surfaces, `--activity-connector`, `--radius 0.625rem`, semantic tokens + `@theme inline` mappings.
- `apps/desktop/src/components/context-bubble/index.ts:1-30` — barrel + `ContextBubble = {Root,Label,Preview,Files,FileItem,Meta}` exemplar.
- `apps/desktop/src/components/context-bubble/_components/root.tsx:20-62` — controlled/uncontrolled `open/defaultOpen/onOpenChange`, `state/actions/meta` context, `data-slot/data-state`.
- `apps/desktop/src/components/context-bubble/_types/context.ts:10-31` — `ContextBubbleContextValue` shape to mirror.
- `apps/desktop/src/components/context-bubble/_hooks/use-context-bubble.ts:10-16` — throws outside `Root`.
- `apps/desktop/src/components/context-bubble/_components/label.tsx:13-40` — `ComponentProps<'button'>`, `aria-expanded/controls`, consumer-first `composeEventHandlers` with `preventDefault` veto.
- `apps/desktop/src/components/context-bubble/_components/preview.tsx:20-31`, `files.tsx:12-23`, `file-item.tsx:17-40`, `meta.tsx:11-21` — replaceable parts, consumer-owned iteration, no child inspection.
- `apps/desktop/src/components/context-bubble/_utils/compose-event-handlers.ts:10-17` — shared merge helper to reuse.
- `apps/desktop/src/components/context-bubble/context-bubble.test.tsx:52` — asserts no `child.type` scanning/dropping.
- `apps/desktop/src/features/settings/settings-navigation.tsx:1-7` — second throwing-context precedent.

## Plan Todos

- [x] Lock scope + ownership (resolved: both timeline and JSON; feature-local owner); record list-markup default and JSON fallback rule before any code change.
- [x] Design the row/tree compound API on paper: LOCKED as ActivityRow v1 (see Design Contracts below).
- [x] Design the JSON tree contract on paper: LOCKED as JsonTree v1 (see Design Contracts below).
- [x] Map files + tokens: LOCKED — new `activity-row/` + `json-tree/` folders under `features/agent/transcript/` with barrel-only `index.ts`; v1 reuses existing `agent.css` classes verbatim (zero `agent.css` / i18n edits by workers); token unify to shared recipes is an explicit follow-up.
- [x] Implement the row compound: DONE 2026-09-19, accepted (13 files under `activity-row/`, oxlint 0, hook internal-only by design). Integration revisions (ROWV1.1): `asChild` cut — zero v1 consumers and desktop cannot import `radix-ui` under pnpm isolation (typecheck + vitest proven); ghost variant restored on Trigger after visual proof caught a white-pill regression. `collapsible-row.tsx` deleted after zero-importer verification.
- [x] Migrate `ThinkingBlock` and `ToolBlock` header: DONE 2026-09-19, accepted (verbatim composition, redacted branch untouched, `aria-label` faithfully mapped since Trigger carries button props). One parent-owned 1-line amendment: pre-existing `react(static-components)` error on the stable module-level tool icon (proven identical on HEAD via baseline stash check) rewritten to the file's existing `createElement` precedent — behavior-identical, lint now green; doc comment reference updated to `ActivityRow.Icon`.
- [x] Implement the JSON tree and migrate `ToolBody` default branch: DONE 2026-09-19, accepted (8 files under `json-tree/`; default branch renders `JsonTree`, edit/bash branches byte-identical, interrupted note kept). Narrow `react/refs` suppression in `node.tsx` reviewed and accepted as a documented false positive (callback identity passed as data; identical JSX-prop shape lints clean). Copy reuses existing `transcript.code.copy/copied` keys; zero new i18n keys.
- [x] Unify `ActivityPhaseView`: DONE 2026-09-19, accepted (header/body/rail on ActivityRow parts; override/waiting/open logic, live pin, single-step bypass, and all copy untouched; 192 lines). Known micro-deltas: body animation moves from grid-rows to Radix height keyframes (visually verified), live phase title gains a hover tooltip from the outer Title (same text), steps become `ul/li` with Tailwind list reset (rail verified pixel-identical).
- [x] Verify contracts: DONE 2026-09-19 (see Execution Record below). Static: oxlint 0 errors on all 25 touched files (warn-level class backlog only), oxfmt clean, `pnpm typecheck` green. Tests: existing transcript suite 8/8 green. Visual: isolated renderer proof (`?proof`, since removed) covered collapsed/expanded rows, phase rail, thinking body, JsonTree nodes/copy overlay, invalid + over-limit fallbacks, redacted/streaming/running states, and 352px-container zero-x-overflow measurement.

## Grill-Me Outcome

- Transcript: Not run
- Outcome: Not run
- Summary: Interview skipped; scope (both) and ownership (feature-local) are resolved and the remaining tree-semantics + JSON-shape items carry recorded defaults. If those defaults are rejected or ownership must promote beyond transcript, run a focused interview before implementation.

## Build From Plan

- Ready to build: Yes
- Selected todos: Full checklist approved 2026-09-19 (row compound first, JSON tree second, phase unify third, verify last) within the locked feature-local scope.
- Execution notes: Plan-mode exited; executing the approved checklist in coordinator waves (new compounds in parallel, then migrations, then parent-owned verification). Re-read the latest user message + this file before each wave, execute only approved checklist items, keep edits scoped to the agreed owner folder + named consumers, preserve unrelated worktree changes, keep each maintained file at most 350 lines after formatting, reuse `Slot.Root`/`Button`/`Collapsible`/`ScrollArea`/`Item` primitives instead of duplicating event/parsing/state logic, and update this file for evidence-backed adjustments within scope.

## Validation

- Static: `pnpm --version` matches root `packageManager`, then `pnpm exec oxlint <changed-files>` (includes 350-line limit + shadcn rules), `pnpm typecheck` for TS/contract changes, `pnpm exec oxfmt <changed-files>` + inspect diff; `pnpm format:check` only as a read-only check.
- Tests: run existing tests exercising touched transcript/activity behavior (no new tests unless explicitly requested); distinguish pre-existing failures from regressions with evidence.
- Visual: renderer-only (`pnpm dev:web` at the origin in `apps/desktop/vite.config.ts`) for layout/copy/states; real isolated app (`AI_TEST_USER_DATA=$(mktemp -d)` + free remote-debugging port, CDP attach) only if IPC/window/native-surface behavior is affected; never disturb a user-owned instance; keep throwaway artifacts in gitignored `tmp/` or `apps/desktop/.artifacts/`.
- Contract proof: one meaningful alternate composition or renderer per advertised seam (row Trigger/Content/Body plus JSON nodes), controlled/uncontrolled parity, host props/ref/class/style/event passthrough, no silent child dropping, JSON parse-failure + large-payload + copy behavior preserved, reduced-motion + keyboard focus preserved.
- Completion bar: applicable checks above pass for the owned scope; remaining gaps reported explicitly without claiming full verification.

## Risks

- Two-track API surface (row compound + JSON tree): locked scope covers both, so sequencing matters; building them as one over-general abstraction risks unclear ownership. Mitigation: implement row compound first, then JSON tree as a separate feature-local composition with its own value contract; share only primitives (`Collapsible`, `Button`, `ScrollArea`) and token vocabulary.
- Wrong owner (feature vs shared): placing a transcript-only API in `packages/ui` adds cross-feature review cost; keeping a genuinely shared row feature-local invites duplication. Mitigation: default to feature-local, promote only with a named second consumer.
- Visual regression in dense Rhea rows: re-mapping `.activity-trigger/.tool-chip/.thinking-*/phase-*` to shared tokens can shift padding, truncation, icon swap, pulse, rail, or capped scrolling. Mitigation: migrate one representative composition first, inspect narrow/wide + long/ wrapped content + streaming/settled states before expanding.
- State-behavior drift: `forceOpen`, `waiting` forces open, finished snaps shut, live pin, single-step bypass, and redacted no-trigger are easy to lose in a generic API. Mitigation: encode them as explicit context state/variants with parity checks, not boolean mode props.
- i18n/copy drift: `tasks` namespace keys (`thinking.*`, `transcript.verb.*`, `activity.*`) are typed from English JSON; rewording English while migrating breaks existing assertions. Mitigation: move copy only, keep English values byte-identical, add no new keys without both `en` + `zh-CN`.
- File-size pressure: unifying three bespoke blocks can push the new compound past 350 lines. Mitigation: split at meaningful part boundaries (`_components`, `_hooks`, `_types`, `_styles`) instead of compressing code or weakening lint.

## Approval

- Status: Approved - executing full checklist

## Design Contracts (locked 2026-09-19, root-owned)

### ActivityRow v1

- Owner: `apps/desktop/src/features/agent/transcript/activity-row/`; kind is product compound with `Root` coinciding state owner and visual frame (ContextBubble precedent).
- Parts: `Root, Trigger, Content, Icon, Title, Meta, Body, Steps, Step`; barrel-only `index.ts` plus `ActivityRow` namespace.
- `Root`: `open? / defaultOpen=false / onOpenChange? / status?: string` plus div props; context `state {open, status} / actions {setOpen, toggleOpen} / meta {contentId, triggerId}`; renders controlled Radix `Collapsible.Root` + provider + div with `data-slot=activity-row`, `data-state`, `data-status`.
- `Trigger`: plain button (default ghost `Button.activity-trigger`), manual toggle via context, consumer `onClick` first with `preventDefault` veto, `aria-expanded/controls`, `data-slot=activity-row-trigger`. No `asChild` in v1 (ROWV1.1: cut — zero consumers, and desktop files cannot import `radix-ui` directly under pnpm isolation; revisit with an `@ai/ui` Slot re-export if host replacement is ever needed).
- `Content`: Radix `CollapsibleContent` passthrough with `id=contentId` (keeps existing height keyframes).
- `Icon`: span box rendering type-icon children plus `ChevronRight` (`rotate-90` when open), `data-slot=activity-row-icon`, reusing `row-icon-swap/row-chevron` classes.
- `Title`: flex-1 truncate span, `data-slot=activity-row-title`. `Meta`: muted xs span, `data-slot=activity-row-meta` (domain passes `tool-chip/activity-meta` classes). `Body`: layout div, `data-slot=activity-row-body` (domain passes `thinking-full/tool-body` classes).
- `Steps`: `ul.phase-steps` with `list-none m-0 p-0` reset, `data-slot=activity-row-steps`; consumer maps `Step` children (consumer-owned iteration). `Step`: `li.phase-step`, `data-slot=activity-row-step`.
- Files: `index.ts`, `_types/context.ts`, `_hooks/use-activity-row.ts` (throws outside `Root`), `_utils/compose-event-handlers.ts` (narrow copy of the ContextBubble helper; cross-feature private imports stay forbidden), `_components/{root,trigger,content,icon,title,meta,body,steps,step}.tsx`. No `_constants/_styles/_providers/_helpers` in v1.
- Status strings: tool rows pass `ToolStatus`; thinking and phase pass `running/completed`. `data-status` is a styling and inspection hook; no v1 CSS depends on it.
- Redacted thinking keeps its plain non-interactive div (no `Trigger`); streaming pulse, `Shimmer`, permission chip, and rejected `X` stay domain-rendered.

### JsonTree v1

- Owner: `apps/desktop/src/features/agent/transcript/json-tree/`; kind is data-driven with component-owned iteration and a single `renderNode` boundary; no public context.
- `Root`: `text / defaultExpandedDepth=2 / maxChars=100000 / renderNode? / fallback?: ReactNode` plus div props; memoized safe parse. Over-limit, parse failure, or blank text renders fallback (default internal verbatim `ScrollArea + pre` with `tool-output` classes; the `fallback` prop replaces it).
- Node model: object, array, primitive; per-node local expanded state defaulting from `depth < defaultExpandedDepth`; collapsed previews use wordless glyphs (`{n}`, `[n]`, `{}`, `[]`, truncated quoted string around 120 chars) so no new i18n keys are needed.
- Copy: branch nodes get a hover-reveal copy `IconButton` (`Check/Copy` icons, existing `transcript.code.copy/copied` keys) via `agentApi().copy` plus error toast; subtree copied as indented JSON; `Root` overlays copy-all (raw text bytes) like Streamdown code controls. Leaves have no copy button in v1.
- `renderNode({key, value, depth, type, expanded, toggle, copy})` replaces default node rendering for every node when provided.
- Files: `index.ts` (`Root` plus types only), `_components/{root,node,fallback}.tsx` (node and fallback internal), `_helpers/parse-json.ts` plus `format-preview.ts`, `_constants/limits.ts`, `_types/node.ts`.
- No imports from `../tool-body` (avoids a tool-body cycle); the fallback intentionally duplicates the short `ScrollArea + pre` markup.
- Streaming partial text re-parses per render (memoized); invalid mid-stream content shows the verbatim fallback until valid.

### v1 non-goals (explicit follow-ups)

- Token unify of `agent.css` classes to shared recipes and `data-slot` selectors (workers reuse classes verbatim; parent records the remaining gap).
- Leaf-node copy, expand-all and collapse-all, raw-view toggle, per-level item caps.
- ARIA tree keyboard navigation (list markup default stands).
- Promotion beyond transcript (needs a named second consumer).

## Execution Record (2026-09-19)

Waves (coordinator, exclusive write boundaries, disjoint parallel pairs): (1) `activity-row/` + `json-tree/` new-file builds in parallel; (2) `thinking-block.tsx` + `tool-block.tsx` migration in parallel with `tool-body.tsx` migration; (3) `activity-group.tsx` unify alone; (4) parent-owned integration, verification, and cleanup. No subplanners; no ephemeral shared memory (plan file plus inline frozen contracts sufficed).

Decisions (root-owned): ROWV1 agreed contracts with one revision to ROWV1.1 (`asChild` cut, reason above); `useActivityRow` stays internal-only (no consumer authors behavior-aware parts yet); narrow `react/refs` suppression in JsonTree accepted as documented false positive; pre-existing `react(static-components)` error repaired with the file's own `createElement` precedent; `collapsible-row.tsx` deleted after verification; live phase tooltip and Radix phase animation accepted as micro-deltas.

Final tree: modified `thinking-block.tsx`, `tool-block.tsx`, `tool-body.tsx`, `activity-group.tsx`; deleted `collapsible-row.tsx`; new `activity-row/` (13 files) and `json-tree/` (8 files). `agent.css`, i18n JSON, lockfile, and configs untouched; `main.tsx` proof wiring reverted; proof page and preview server removed; ports 5173 (other-owned, never touched) and 5199 (mine, verified free again) accounted for.

Validation observed: `pnpm exec oxlint` on all 25 touched files exits 0 (warn-level `no-unknown-classes` backlog only, same kind as baseline); `pnpm exec oxfmt --check` clean; `pnpm typecheck` green (2 packages); existing transcript vitest suite 8/8 green; renderer-only proof verified every listed state above plus a11y roles (`button` names, `listitem` steps, `aria-expanded` transitions) and zero horizontal overflow at 352px container width.

Remaining gaps (honest): no true-400px-viewport pixel capture (screenshot tooling failed under CDP emulation; substituted with DOM overflow measurement); hover-reveal branch copy buttons confirmed present in DOM but not screenshotted mid-hover; native Electron composition not inspected (change is renderer DOM/CSS only, no native-surface edits); uncontrolled `defaultOpen` and custom `renderNode` have zero production consumers (type-correct, behavior covered by parity with the controlled path); token unify to shared recipes stays a follow-up.

Follow-up 2026-09-19: proof page rebuilt on user request at the same URL with a page-level scroll-container fix (`body overflow hidden` had clipped the long `main`). Tree currently also holds untracked `src/__proof__/` plus `main.tsx` wiring; remove both after review.
