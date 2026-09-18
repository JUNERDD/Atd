# Monocode visual equivalence on Pi architecture

Status: Executed T1 through T11, Figma excluded; validation complete with noted gaps
Created: 2026-09-18
Approval: User authorized execution on 2026-09-18 with no Figma updates; defaults accepted for icons, images, mermaid

## Summary

Objective: port monocode assistant-message rendering to visual equivalence inside the existing Pi agent architecture. Keep the canonical flat `Block` document in the main process with snapshot plus coalesced upsert patches over IPC. Add a renderer-side reshape adapter after `applyTranscriptPatch`, then reuse monocode information architecture semantics (`groupTurns`, `groupTurnItems`, `buildActivityPhases`, `activityPhaseTitle`, `TurnDuration`, `LiveWorking`) while rebuilding the visual layer to monocode equivalence.

Acceptance: tool-call phase headers show monocode verbs with counts (`Ran a command`, `Ran N commands`, `Explored`, `Edited`), live footer shows elapsed with model and clock, thinking rows collapse to a single line without triple-title stacking, assistant streaming grows without truncation perception, jump affordance no longer collides with status, code blocks match line numbers plus copy and download controls, mermaid renders or degrades explicitly, English and Chinese strings stay in sync.

Non-goals: Pi session-file format changes, run-policy next-run capability model changes, mid-run queue protocol changes beyond display, inbox and terminal and editor surfaces, handoff and second-opinion product scope, full-app skin migration outside transcript.

Constraints: 350-line limit per maintained file, pnpm workspace with lockfile discipline, Electron main plus preload plus renderer boundaries with narrow typed bridge, `contextIsolation` plus sandboxing preserved, no direct `rehype-harden` bypass of the Electron link policy, Lucide for functional icons with Logos for brands, Rhea preset preserved except an explicitly recorded transcript-surface exception.

## Clarifying Questions

- [x] Q1 scope: pixel skin versus information equivalence. Resolved as evaluation-first; user requested direct-migration feasibility before deciding.
- [x] Q2 path: IA-only reshape versus full skin port. Resolved as full visual equivalence direction with Pi-architecture adapter and dependency equivalence-first policy.
- [x] Figma sync timing: resolved as no Figma updates for this execution per user directive on 2026-09-18. The transcript exception stays recorded in code and plan only.
- [x] File-type icon fidelity: accepted default Lucide mapping without a new package for this execution.
- [x] Image policy in markdown: accepted default keep alt-text stripping with recorded gap for this execution.
- [x] Mermaid loading under Electron CSP: accepted default lazy-load with an explicit fallback component for this execution.

## File And Code References

Monocode reference (read-only):
- `/Users/zen/Documents/Project Source/monocode/src/surfaces/SessionPane.tsx:335-360` transcript host with jump overlay.
- `/Users/zen/Documents/Project Source/monocode/src/surfaces/AgentTranscript.tsx:113-130,301-430` turn shell, live gating, footer placement.
- `/Users/zen/Documents/Project Source/monocode/src/surfaces/AgentTranscript.tsx:847-879,945-1090` phase grouping with live pinning and expand behavior.
- `/Users/zen/Documents/Project Source/monocode/src/surfaces/AgentTranscript.tsx:1123-1171,1177-1366` thinking plus note plus tool row variants.
- `/Users/zen/Documents/Project Source/monocode/src/surfaces/AgentTranscript.tsx:433-571,1390-1472` live footer, elapsed formatting, copy and save actions.
- `/Users/zen/Documents/Project Source/monocode/src/surfaces/AgentMarkdown.tsx:1-80,346-380` Streamdown shell with code plus mermaid plus harden configuration.
- `/Users/zen/Documents/Project Source/monocode/src/surfaces/mermaidPlugin.ts:1-53` lazy mermaid factory with strict config.
- `/Users/zen/Documents/Project Source/monocode/src/surfaces/transcriptActivity.ts:182-199,205-264,279-377,471-511` turn split, fold timing, phase build, title verbs.
- `/Users/zen/Documents/Project Source/monocode/src/lib/session.ts:27-37,106-133,163-236` block roles, tool preview, harness titles.
- `/Users/zen/Documents/Project Source/monocode/src/index.css:123-146,296-620,653-677,796-937` turn containment, markdown skin, shimmer, phase rail and motion.
- `/Users/zen/Documents/Project Source/monocode/package.json:33-52` hugeicons, streamdown plugins, harden, react 19.

Current Pi architecture (preserve):
- `/Users/zen/Documents/ZProject/ai/apps/desktop/electron/agent/worker-session.ts:179-222` live partial projection source.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/electron/agent/transcript.ts:113-195` projection plus diff.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/electron/agent/transcript-project.ts:82-222` Pi event to block mapping.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/electron/agent/transcript-publish.ts:7-54` 40ms patch publisher.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/electron/agent/transcript-schema.ts:17-189` block ids, statuses, patch apply.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/electron/agent/bridge.ts:46-76,189-228` detail plus transcript event contract.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/use-agent.ts:43-103` seed plus patch apply in renderer.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/transcript/turns.ts:6-163` current fold plus live plus anchors.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/transcript/transcript.tsx:27-100` scroll plus jump composition.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/transcript/activity-group.tsx:11-65` count-only titles, live open.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/transcript/thinking-block.tsx:10-52` title plus summary fallback.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/transcript/tool-block.tsx:13-82` status icon plus collapsible body.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/transcript/markdown.tsx:11-76` bare Streamdown with custom link plus image plus scroll wrappers.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/transcript/status-bar.tsx:32-110` in-flow working plus terminal cards.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/transcript/use-transcript-scroll.ts:8-77` pin plus jump plus viewport var.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/features/agent/agent.css:174-211,232-413` conversation, jump, activity, markdown, status styles.
- `/Users/zen/Documents/ZProject/ai/packages/ui/src/styles.css:14-99` panel tokens plus Rhea theme.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/i18n/locales/en/tasks.json:20-32,49-56,107-115` working, activity, thinking, permission strings.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/src/i18n/locales/zh-CN/tasks.json:23-30,113-115` Chinese mirror keys.
- `/Users/zen/Documents/ZProject/ai/apps/desktop/package.json:22-66` desktop dependencies and scripts.
- `/Users/zen/Documents/ZProject/ai/packages/ui/package.json:17-25` shared UI dependencies.

## Dependency Equivalence

Context7 library ID `/vercel/streamdown` with high reputation was used for Streamdown docs. GitHub ref `vercel/streamdown` at `refs/tags/streamdown@2.6.0` (`8a2ac22`) and `refs/tags/streamdown@2.5.0` (`15ba1ae`) was used for release matching.

- `@streamdown/code` at `^1.1.1`: docs show `plugins={{ code }}` with `CodeBlock` line numbers plus copy and download controls. No in-project equivalent exists; CodeMirror packages are editors, current `ScrollArea` plus `pre` lacks highlighting and controls. Decision: add direct dependency via pnpm.
- `@streamdown/mermaid` at `^1.0.2`: docs show `createMermaidPlugin` with theme plus error component plus download, copy, fullscreen, pan and zoom controls. No in-project mermaid support exists. Decision: add direct dependency with lazy loading and an explicit fallback.
- `rehype-harden` at `^1.1.8`: `streamdown@2.6.0` core already depends on it, but pnpm does not expose transitive imports for direct configuration. Monocode imports `harden` directly with link prefix, data-image, and block-remove options. Current code relies on Streamdown defaults plus custom link and image components. Decision: add direct dependency to permit monocode-equivalent configuration while keeping `agentApi.openLink` for external navigation.
- `unified` `PluggableList`: type-only need already satisfied transitively through Streamdown. Decision: replace with inferred Streamdown prop types and do not add a direct package.
- Hugeicons versus `lucide-react` at `1.42.0`: transcript glyphs map functionally to Lucide names, while pixel shapes differ. Repository icon rules mandate Lucide. Decision: remap to Lucide and do not add Hugeicons.
- `react-material-icon-theme` file glyphs: no equivalent package in the workspace. Decision: use Lucide `File*` mapping plus Logos brands for phase one, defer material theme unless acceptance fails on file fidelity.
- `streamdown` `2.5.0` versus `2.6.0`: same major with React 18 and 19 peers. Docs confirm `Streamdown`, `CodeBlock`, `defaultRehypePlugins`, and code-fence incomplete helpers remain supported. Decision: keep `2.6.0` and verify exports during typecheck.
- Combined verification gaps: Context7 has no dedicated `rehype-harden` entry, so harden behavior rests on GitHub package evidence plus local monocode configuration. Mermaid CSP behavior under Electron remains a runtime validation item.

## Plan Todos

- [x] T1 Contract adapter: renderer-side projection shipped in `transcript/adapter.ts` with title, status, preview, approval, and turn-timing synthesis. Main-process schema and IPC patch shape unchanged.
- [x] T2 Phase semantics: `finalResponseStart` fold timing plus phase build plus live verb inflection shipped behind `Button` composition with `aria-expanded`. Triple thinking titles removed via single-line rows plus lone-step direct render.
- [x] T3 Footer and scroll: per-turn elapsed line shipped, then moved to a top header under the user message per follow-up (no folding, copy removed in favor of turn actions); live `StatusBar` line removed to end duplication; 16px stick-to-bottom plus jump plus viewport sync preserved; 20-turn windowing with load-earlier added.
- [x] T4 Markdown core: Streamdown code plugin with line numbers plus copy and download shipped; narrow `agentApi.openLink` bridge kept; scroll wrappers kept for code and tables.
- [x] T5 Mermaid: lazy mermaid plugin with neutral theme plus error fallback plus copy controls shipped; Electron CSP runtime proof still open with degrade path in place.
- [x] T6 Harden configuration: `rehype-harden` direct dependency added and link prefix plus data-image plus block-remove policy ported; alt-text image stripping retained as the recorded sandboxed exception.
- [x] T7 Visual exception: transcript tokens for rail connector, live window, footer row, markdown code and table treatments, and reduced-motion coverage shipped in transcript-owned stylesheet sections without Tauri glass.
- [x] T8 Icons: phase and row glyphs remapped to `lucide-react` with extension-based file mapping; Rhea button and `Kbd` contracts preserved.
- [x] T9 Internationalization: 49 `transcript.*` keys added in English and Chinese with identical sets; renderer consumes 44 with literal key strings; 5 keys intentionally unused with reasons recorded.
- [x] T10 Splits and hygiene: every touched maintained TS and TSX file at or under 350 lines after formatting; existing tests updated only where behavior intentionally changed; no new test files.
- [x] T11 Validation: scoped lint plus typecheck plus affected Vitest plus build plus isolated boot smoke complete; content-rich parity, native composition, and full English-locale smoke remain recorded gaps.

## Grill-Me Outcome

- Transcript: `/Users/zen/Documents/ZProject/ai/tmp/grill-me/session-transcript-1to1-20260918-20260918-171403.md`
- Outcome: `/Users/zen/Documents/ZProject/ai/tmp/grill-me/outcome-transcript-1to1-20260918-20260918-171403.md`
- Summary: Q1 asked pixel versus information scope and received an evaluation-first reply; Q2 presented blocked verbatim migration evidence and received a visual-equivalence decision on Pi architecture with equivalence-first dependency policy. Execution authorized with no Figma updates.

## Build From Plan

- Ready to build: Yes
- Selected todos: T1 through T11 with no Figma updates
- Execution notes: Preserve unrelated dirty changes on `feat/v0.1`. Wave 1 deps plus i18n ran in parallel with disjoint ownership and both accepted. Wave 2 renderer transcript integration accepted with 4 recorded deviations (phase-body Button plus CSS grid, `StatusBar` requests prop removal, mermaid fallback without retry, single-title phases). Wave 3 root validation complete. Electron work ran in an isolated profile with `AI_TEST_USER_DATA` on verified-free port 9333 with polling, and owned instances plus profiles were removed. Throwaway script plus log plus screenshot kept under gitignored `tmp/` and `apps/desktop/.artifacts/`. Follow-ups: elapsed line moved to a top header without folding or copy; scroll follow split from jump writes and messages bottom-justified with the turn anchor removed.

## Validation

- Confirm `pnpm --version` matches root `packageManager` before workspace validation.
- Run scoped `pnpm exec oxlint` for touched files without unrelated `--fix`.
- Run `pnpm typecheck` for contract, import, and build-config changes.
- Format only task-owned files with `pnpm exec oxfmt` and inspect the diff.
- Run affected Vitest suites for projection parity plus renderer fixtures.
- Run `pnpm build` and isolated `pnpm test:electron` for IPC plus native-surface behavior.
- Verify native window composition on contrasting backgrounds for corners, edges, shadow, and material.
- Verify panel widths 320, 420, and 640 plus short heights with long titles, wrapped actions, expanded forms, and visible errors.
- Verify English and Chinese locale parity for all new transcript strings.
- Verify reduced-motion behavior for shimmer, phase animation, and spinner paths.
- Evidence 2026-09-18: `pnpm --version` 12.3.4 matches; oxfmt plus oxlint clean on touched files; desktop typecheck 0 errors; Vitest 53 of 53 pass with 11 transcript tests; `pnpm build` exit 0; isolated Electron boot clean with empty console and rendered zh-CN shell; screenshot at `apps/desktop/.artifacts/transcript-smoke-panel.png`.
- Gaps 2026-09-18: fresh profile carries no tasks so Fig1 content parity is not runtime-verified; native OS composition is not inspected; mermaid engine load under Electron CSP is not runtime-proven with fallback in place; full `test:electron` is not run because it asserts English copy while this machine renders zh-CN.

## Risks

- Full skin equivalence overturns the prior Rhea-only transcript decision and creates a maintained visual exception.
- Approval id coercion from string side-channel to numeric inline shape can collide unless hashing stays stable across patches.
- Preview synthesis from `args` plus unified diff cannot fully recover structured line metadata.
- Timestamp-derived turn timing cannot reproduce pause-aware elapsed time under approval waits.
- Dropped concepts without explicit product calls include run grouping, stop reason, redaction flags, question options and answers, attachments, notes, handoff, and subagent phases.
- Mermaid lazy loading plus CSP plus font behavior under Electron needs runtime proof.
- Image stripping versus monocode media rendering remains an intentional visual gap for sandbox safety.
- 40ms patch cadence plus markdown rerender can jank long turns unless projection memoizes by revision.
- Dirty `feat/v0.1` worktree increases merge and ownership collision risk without isolated write boundaries.

## Approval

- Status: Executed
- Direction decided: visual equivalence on Pi architecture with equivalence-first dependencies
- Pending: none; all waves complete with evidence plus gaps recorded above
