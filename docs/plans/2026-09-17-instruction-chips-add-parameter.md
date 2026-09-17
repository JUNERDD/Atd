# 指令编辑器：变量行内新增「添加参数」入口

Status: Implemented - 2026-09-17 落定：变量行 = 四个上下文变量（未启用为配置态）+ 参数 + 「添加参数」；工具栏「插入变量」入口移除，无引用清理完成
Created: 2026-09-17
Approval: 已授权实施（原始指令为实施类）；2026-09-17 用户取消后又按新截图恢复：变量行保留「+ 添加参数」按钮，并移除 `instruction-editor.tsx:77-116` 的工具栏按钮

## Summary

在 `apps/desktop/src/features/commands/instruction-editor.tsx` 的 `variable-chips` 块（151–165 行）末尾新增一个「+ 添加参数」按钮，复用组件已有的 `onAddParameter` prop（`command-editor.tsx:160` 已把它接到打开 `ParameterEditor` 的流程）。

用户澄清后的最终范围：

- 只新增该按钮；工具栏「插入变量」Popover（77–116 行）、变量选择器底部的「添加参数」项（`variable-picker.tsx:101-104`）都保持现状——用户明确表示「其他不需要」，选择器无需移除该项。
- 变量 chips 行为不变（点击即插入 `{{name}}`）；截图中的红 × 只是标注。

## Clarifying Questions

- [x] Q1：只移动「添加参数」入口，还是整块移动「插入变量」Popover？→ 用户答复：只需要在 151–165 添加按钮，其他不需要。
- [x] Q2：chips 上的红 × 是否属于本次改动？→ 用户答复：只是标注，chips 不变。

## File And Code References

- `apps/desktop/src/features/commands/instruction-editor.tsx:151-165` — 改动点：`variable-chips` 容器，在 `available.map(...)` 之后追加按钮。
- `apps/desktop/src/features/commands/instruction-editor.tsx:19-25` — `onAddParameter: () => void` 已是组件 props，直接复用。
- `apps/desktop/src/features/commands/instruction-editor.tsx:6` — 需从 `lucide-react` 追加导入 `Plus`（截图按钮带 + 号；与 `command-editor.tsx:189` 的写法一致）。
- `apps/desktop/src/features/commands/command-editor.tsx:184-191` — 参数区已有同款按钮（`variant="outline"`、`<Plus />` + `t('parameters.add')`）；本次沿用相同文案与图标。
- `apps/desktop/src/features/commands/variable-picker.tsx:101-104` — 「添加参数」项所在位置；本次不改动。
- `apps/desktop/src/i18n/locales/{en,zh-CN}/commands.json:86` — 复用现有 key `parameters.add`（en `Add parameter` / zh-CN `添加参数`），无需新增翻译。
- `packages/ui/src/components/button.tsx:41-61` — Button 未默认 `type`，与 chips 一致显式传 `type="button"`。
- `apps/desktop/src/App.test.tsx:291-301` — 渲染 `SettingsWindow` 深链到命令编辑器的既有测试，是本改动可用的回归检查面。
- 复用决策：直接复用 `packages/ui` 的 `Button` 与既有 i18n key，无新增依赖或自建控件；仓库中无 `border-dashed` 先例，截图虚线框按标注处理，样式取 outline/sm 以对齐 chips 行几何。

## Plan Todos

- [x] 在 `instruction-editor.tsx` 的 `variable-chips` 块内、chips 映射之后新增按钮：`type="button" variant="outline" size="sm" onClick={onAddParameter}`，内容为 `<Plus />` + `t('parameters.add')`；追加 `Plus` 导入。
- [x] 确认不改动其他文件：工具栏 Popover、`VariablePicker`、chips 本身均保持原样。
- [x] 格式化与静态检查：`pnpm exec oxfmt` 该文件、`pnpm exec oxlint` 该文件、`pnpm typecheck`。
- [x] 运行桌面端测试（含上述深链渲染用例）：`pnpm --filter @ai/desktop test`。
- [x] 复核 diff 与验收标准；报告未执行的验证（Figma 同步、运行时/视觉验收）及原因。
- [x] 2026-09-17 用户取消按钮需求：移除新增按钮与 `Plus` 导入，文件回到仅含用户既有 FieldHint 改动的状态；oxfmt/oxlint、桌面端 typecheck 与测试（4 文件 20 用例）复跑通过。
- [x] 第二轮（2026-09-17，新截图）：变量行恢复「+ 添加参数」按钮；移除工具栏「插入变量」Popover 及其全部接线（`open`/`preserveTargetFocus` 状态、`VariablePicker`、错误提示「查找」入口、`onConfigureSource` prop 与 `command-editor.tsx` 中的滚动/聚焦接线、`commands.css` 的 `.instruction-actions` 规则）。
- [x] 第二轮验证：oxfmt/oxlint（3 个改动文件）、`pnpm --filter @ai/desktop typecheck`、`pnpm --filter @ai/desktop test`（4 文件 20 用例）通过。
- [x] 清理（2026-09-17）：删除无引用的 `variable-picker.tsx`、`commands.css` 中 `.variable-picker` 与 `.variable-option` 规则、i18n 中仅弹层使用的键（`variables.insert/done/search/empty/builtIn/yourParameters/noParameters/enableFirst/configure/configureFor/insertFor/footerHint`、`instruction.find`，en 与 zh-CN 同步）；oxfmt/oxlint、桌面端 typecheck、测试（4 文件 20 用例）通过。
- 未做运行时/视觉验收；`docs/design-source.md` 仍有 `variable-picker.tsx` 的引用与相关设计记录（本次未改动该文档）。
- [x] 剪切板 token（2026-09-17，用户选择「显示为可配置状态」）：变量行始终列出四个上下文变量；已启用者保持可插入，未启用者显示为 muted + `Settings2` 的配置态，点击滚动并聚焦「输入选项」对应开关（恢复 `onConfigureSource` 接线与 `variables.configureFor` 文案）。启用/关闭来源会在 chips 与配置态之间切换。
- 验证：oxfmt/oxlint、桌面端 typecheck、测试（4 文件 20 用例）通过。
- 未做运行时/视觉验收；Figma 未同步（本会话无 Figma MCP 工具），配置态的具体视觉（图标/文案/样式）按原弹层行为实现，待与设计核对。

## Grill-Me Outcome

- Transcript: Not run
- Outcome: Not run
- Summary: 未使用；范围经澄清已收敛为单文件小改动，无剩余需用户裁决的设计问题。

## Build From Plan

- Ready to build: Yes
- Selected todos: 全部（用户澄清即授权范围）
- Execution notes: 单文件、单控件改动，直接实施。

## Validation

- `pnpm exec oxfmt apps/desktop/src/features/commands/instruction-editor.tsx`
- `pnpm exec oxlint apps/desktop/src/features/commands/instruction-editor.tsx`（文件仍远低于 350 行）
- `pnpm typecheck`（涉及 TSX/导入变更）
- `pnpm --filter @ai/desktop test`：覆盖 `SettingsWindow` 深链渲染命令编辑器的既有用例
- 未执行（需授权/能力）：运行时或视觉验收（AGENTS.md 运行时限）、Figma 同步（本会话无 Figma MCP 工具）

执行结果（2026-09-17）：

- `pnpm exec oxfmt` / `pnpm exec oxlint` 该文件：通过（lint exit 0，文件 172 行）。
- `pnpm --filter @ai/desktop typecheck` 与根 `pnpm typecheck`：通过。
- `pnpm --filter @ai/desktop test`：4 个文件、20 个用例全部通过（含 `App.test.tsx` 深链渲染 `SettingsWindow` 命令编辑器的用例）。

## Risks

- 新增入口后，「添加参数」在界面上共有三处（chips 行、参数区标题、变量选择器底部）。这是用户明确接受的范围。
- 截图虚线边框仅视为标注；若 Figma 设计确实要求 dashed 边框，需要一次后续样式微调（本会话无法读取 Figma 验证）。
- 未做运行时/视觉验收：按钮实际渲染（换行、与 chips 对齐、短高窗口）未观察，仅通过静态检查与组件测试。

## Approval

- Status: 已授权（用户澄清范围内直接实施）
