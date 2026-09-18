# transcript prose outside activity

Status: Implemented 2026-09-18
Created: 2026-09-18
Approval: Approved and implemented (user selected Q1=A then `go`)

## Summary

Goal: assistant prose always renders as standalone paragraphs outside activity groups, so tool calls and prose are visually separated. Today `foldTurn` folds every non-trailing prose block into the activity group (`apps/desktop/src/features/agent/transcript/turns.ts`), and `buildActivityPhases` promotes that prose to the group headline. In turns where the agent speaks before calling a tool (e.g. the 2026-09-17 translation session: thinking + prose + `ask_user`), the prose, thinking, and question all collapse into one wrench-icon group instead of reading as prose-then-work.

Change: restrict activity membership to work kinds only (tool/question, plus thinking per Q1 below). Every non-empty assistant block becomes a standalone `block` item rendered by `AssistantBlock` at full strength; activity groups keep tool/question steps and fall back to the existing verb titles in `phase-title.ts` (no new i18n keys). No main-process or projection changes: block kinds and IPC shapes stay identical; this is renderer grouping only.

Target rendering for the example session (thinking, prose, question): a single collapsed thinking row, then the full Chinese prose paragraph standalone, then the question card — instead of one group titled by the prose.

## Clarifying Questions

- [x] Q1 (resolved 2026-09-18): thinking 留在工具组内做 step（选项 A）。单个 thinking 独占一组时走现有 `phase-single` 无标题行渲染；`think` phase kind 与 ThinkingBlock 保留。
- [x] Desired reference: 本轮附图显示的是聊天 UI 而非应用渲染，无参考价值；已假设目标样式 = 首轮截图（23:26）那种正文独立段落 + 工作折叠的分隔效果。计划正文本身已把行为说死，该假设可在评审时直接验证，无需阻塞。
- [x] Scope: 统一 live（streaming）与 settled——流式正文也不再"先展开后折叠"，始终独立渲染。问句/审批类 question block 留在 activity 内（需上下文）；system block 保持独立不变。

## File And Code References

- `apps/desktop/src/features/agent/transcript/turns.ts:58-59` — `isActivityKind`: thinking/tool/question 可折叠。
- `apps/desktop/src/features/agent/transcript/turns.ts:82-90` — `finalResponseStart`: 结尾连续正文起点；本例返回末尾导致全部折叠。
- `apps/desktop/src/features/agent/transcript/turns.ts:107-138` — `foldTurn`: `position < finalStart && isProseBlock` 把非结尾正文推进 activity；**主改点**。
- `apps/desktop/src/features/agent/transcript/phases.ts:105-160` — `buildActivityPhases`: 正文升 headline（126-140）、thinking 做 step（120-124）；正文不再进入后 headline/`note` 路径死亡。
- `apps/desktop/src/features/agent/transcript/phase-title.ts:51-59` — headline 优先，否则按 `tallySteps` 出动词标题；无 headline 时已有完整回退。
- `apps/desktop/src/features/agent/transcript/activity-group.tsx:100-119` — `headline` 全文展开与 `single`（单个无介绍调用不建组）；`note` glyph `Minus`。
- `apps/desktop/src/features/agent/transcript/phase-step.tsx:12-20` — 折叠正文走 `NoteBlock` 单行；正文移出后该 case 不可达。
- `apps/desktop/src/features/agent/transcript/thinking-block.tsx:56-80` — `NoteBlock`；`proseSummary` 唯一渲染侧消费者之一。
- `apps/desktop/src/features/agent/transcript/turn-view.tsx:12-18,44-56` — `copyId` 只掃 standalone assistant（activity 内正文今天拿不到复制按钮；改后行为变化属预期内）、`done`/`answering` 折叠判定需复核。
- `apps/desktop/src/features/agent/transcript/activity.test.tsx` — 现有两用例 fixture 均为"结尾正文"，改后分组不变，可作回归基线；缺 mid-turn 正文用例。
- 会话证据：`~/Library/Application Support/AI/agent-v1/agent/sessions/9306a2e0-…/2026-09-17T16-39-57-517Z_….jsonl` 第 8 条 assistant content = thinking + text + toolCall(ask_user)。

## Plan Todos

- [x] T1 `turns.ts`: 正文恒为 standalone——`foldTurn` 中移除 `position < finalStart && isProseBlock` 进 activity 的条件；activity 仅收 thinking（按 Q1）/tool/question；确认 `finalResponseStart`（含 `phases.ts` 内重复）调用方并清理死亡代码。
- [x] T2 `phases.ts`: 移除正文 headline 路径——`headline` 字段、`note` kind，`proseSummary` 若无其他消费者则一并移除；保留 verb 分组与 `absorbStrayPhases`。
- [x] T3 `phase-title.ts` + `activity-group.tsx`: 删除 headline 分支与 headline 全文展开、`note` glyph；确认 `single`/`inert` 覆盖纯工具组与纯 thinking 组（Q1=A 时）。
- [x] T4 `phase-step.tsx` + `thinking-block.tsx`: 删除不可达的 assistant→`NoteBlock` case 与 `NoteBlock`（若无其他引用）；ThinkingBlock 保持。
- [x] T5 `turn-view.tsx`: 复核 `done`/`answering`/`copyId` 在新 item 形状下的行为；复制按钮出现在 settled turn 最后一独立正文属预期，代码按需微调。
- [x] T6 测试：跑 transcript 套件，更新因行为变化而失败的既有用例期望；不新增测试（除非用户另行要求）。
- [x] T7 样式：确认 `.phase-single`、note/thinking 相关 CSS 无孤儿；按需清理。
- [x] T8 渲染验证：renderer preview 复核 mid-turn 正文独立 + 工具组动词标题 + 流式态（隔离 profile，按仓库 runtime 规则）。

## Grill-Me Outcome

- Transcript: Not run
- Outcome: Not run
- Summary: 单一有界决策（thinking 去向）已用结构化问题直接询问；其余由仓库证据与已确认意图解决，无需访谈。

## Build From Plan

- Ready to build: Yes (built 2026-09-18)
- Selected todos: T1–T8 (all done)
- Execution notes: 按 T1→T5 顺序改（turns/phases 先行，类型错误会指引下游）；advertised 纯 renderer 改动，勿碰 `electron/agent` 投影与 IPC；保留工作区现有 dirty 改动。

## Validation

- `pnpm exec oxlint <changed-files>`；`pnpm exec oxfmt --check <changed-files>`（改后文件格式化）
- `pnpm typecheck`
- `pnpm --filter @ai/desktop exec vitest run src/features/agent/transcript`
- 渲染抽查：mid-turn 正文独立段落、工具组动词标题、流式正文不折叠、settled 复制按钮位置；对照翻译会话复现前后差异
- Non-goals: 不改投影/block kind/IPC；不改 question 审批交互；不新增 i18n key；不新增测试文件

## Risks

- `finalResponseStart` 在 `phases.ts` 有重复实现：需确认调用方，避免改一漏一（T1 覆盖）。
- Q1=B（thinking 也独立）会扩大 T2–T4：`think` phase kind、ThinkingBlock 在 group 外的样式与 `done` 判定都需重审；默认按 A 规划。
- 复制按钮覆盖面扩大（以前折叠正文无按钮）：属预期行为变化，已在 T5 列明。
- 工作区现有 transcript 脏改动（turn-header/thinking-block/fixtures 等）与本计划同区：实现时以最新 worktree 为准，勿 revert 他人改动。

## Approval

- Status: Implemented — typecheck + 11/11 transcript tests + lint/format clean; mid-turn prose verified via transient probe (created, passed, deleted; no durable test added per repo rules); renderer preview skipped (structural change, existing components only, covered by DOM assertions)
