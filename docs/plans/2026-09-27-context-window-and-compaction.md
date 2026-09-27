# 上下文窗口档位与自动压缩

Status: Completed - P0–P3, Figma sync and end-to-end verification done
Created: 2026-09-27
Approval: Approved (user: 85% 可以，两档都做、按模型记住，按 P0 到 P3 全部实施，允许整理成新计划；允许更新 Pi 相关依赖)

## Summary

模型选择器的 Context 行目前只读（`2026-09-19-plan.md` Q1/T6），用户无法选择上下文窗口；pi 自动压缩已默认开启，但产品层没有接住：压缩中无提示、失败被吞掉、摘要原文以无标签灰色系统块出现、1M 窗口要到约 98% 才压缩。

本计划按调研结论实施四个阶段：

- **P0** 升级 pi 依赖到 0.87.1（获得 context edit、可操作的 turn 边界与压缩统计修复）。
- **P1** 自动压缩的触发策略、可见性与失败处理：由 service 按模型统一决定，不给普通用户可调项。
- **P2** 上下文窗口两档（标准 / 长上下文），按“连接 + 模型”记住；上下文用量圆环。
- **P3** 压缩前先清理旧工具输出（第一层），摘要为第二层。

## 决策变更

本计划推翻 `docs/plans/2026-09-19-plan.md` 中 “Context 行只读” 的决定（该文 `:16`、`:28`、`:62`）。依据：pi 虽无逐请求窗口参数，但 `models.json` 的 `modelOverrides.<id>.contextWindow` 是受支持的按模型覆盖方式（pi `docs/models.md`，GPT-5.6 272k→1.05M 即用此法）；Copilot in VS Code 已采用“仅在存在真实计价取舍时给两档、按模型记住”的做法。该文 “不新增 `RunPolicy.context` 字段” 的非目标仍然保留：窗口选择是连接上的按模型偏好，不是按次运行参数。

## 已确认决策

- D1 自动压缩在有效窗口约 **85%** 触发。
- D2 上下文窗口提供 **两档**：`standard` 与 `long`；按 **连接 + 模型** 记住，只存与默认不同的档位。
- D3 **P0→P3 全部实施**；允许更新 pi 相关依赖。
- D4 不给普通用户暴露压缩阈值、压缩模型或压缩策略设置；压缩用会话本身的模型。
- D5 不做：各家 API 自带压缩（等 pi 原生支持再评估）、Handoff、直接依赖社区压缩包、`[1m]` 式模型变体、`anthropic-beta` 头（在 pi 中会整体替换自动 beta 列表）。
- D6 同一任务压缩两次及以上后，轻提示“新开任务效果更好”。

## 调研依据（摘要）

- pi 0.86.1/0.87.1：`shouldCompact = tokens > contextWindow − reserveTokens`；默认 `reserveTokens` 16384、`keepRecentTokens` 20000；`compaction.modelOverrides["provider/id"]` 可按模型设置二者；溢出时压缩并重试一次；事件 `compaction_start {reason}` / `compaction_end {reason, result, aborted, willRetry, errorMessage}`；扩展事件 `session_before_compact` / `session_compact` / `session_compact_failed`；`session.compact(customInstructions)`、`abortCompaction()`、`getContextUsage()`。0.87.0 新增 `sessionManager.appendContextEdit(entryId, null | replacement)`（只影响后续模型上下文，不改原始记录）、可操作的 `turn_end` / `agent_before_settle` 边界、`SessionEntry` 新增 `context_edit`（破坏性变更）。
- 业界：触发点 80–90%（Copilot≈80%、Goose/Kiro 80%、Zed/Amp/Codex 90%）；先清旧工具输出再摘要（Claude Code、OpenCode、Gemini CLI、Anthropic 上下文编辑）；UX 为进度行 → “已压缩 X→Y” 可展开标记 → 用量指示 → 多次压缩后建议新开。
- pi 生态：无适合直接依赖的包（依赖 CLI 配置文件/TUI/更新的 pi，或改写原始请求）；采用 pi 自带接口，参考官方 `examples/extensions/{trigger-compact,custom-compaction}.ts` 与 `pi-context-prune`、`@henryqw/pi-auto-compact` 的设计。

## 接口契约 C1（阶段 P1/P2 共用，由 contracts worker 落地，版本 C1）

### 上下文档位

- `ServiceConnection.contextTiers?: Record<modelId, 'standard' | 'long'>`：只存与默认不同的档位；缺省表示全部默认。桌面 `ConnectionConfigSchema` 镜像同名字段。
- 档位推导由 service 独占（`apps/agent-service/src/providers/context-tiers.ts`），不按模型名猜：
  - 设模型目录窗口为 `W`，计价阈值 `T = min(cost.tiers[].inputTokensAbove)`（无 tiers 则无），扩展上限 `L` 来自 service 维护的带来源小表（无条目则 `L = W`）。
  - `T < W`：`standard = T`，`long = W`，默认 `long`（保持现有行为）。
  - 否则 `L > W`：`standard = W`，`long = L`，默认 `standard`。
  - 否则无档位，Context 行保持只读。
  - 首批扩展表只收录有一手来源的条目：`openai/gpt-5.5`、`openai/gpt-5.6-sol`、`openai/gpt-5.6-terra`、`openai/gpt-5.6-luna` → 1,050,000（pi `docs/models.md`；developers.openai.com 模型页）。新增条目须在注释里写明来源。
  - 自定义/本地模型沿用现有数值输入框，无档位。
- 查询：`GET /v1/providers/:connectionId/contexts?modelId=` → `{ options: Array<{ tier: 'standard' | 'long'; contextWindow: number; pricedAbove: number | null }>; defaultTier: 'standard' | 'long' | null; selected: 'standard' | 'long' | null }`；无档位时 `options` 为空、`defaultTier`/`selected` 为 `null`。`pricedAbove` 为超过后整单按更高价计费的阈值（仅 `long` 档且存在 `T` 时非空）。
- 写入：`PUT /v1/providers/:connectionId/context` `{ expectedRevision, modelId, tier }` → `ProviderConnectionResponse`；与默认相同则删除该条目。
- 生效：运行冻结时 service 解析有效窗口写入 `RunSnapshot.contextWindow`（整数，缺省为模型目录值），运行期间不随偏好变化。`openRunModel` 与子 agent 的 `childRuntime` 使用同一份按内容寻址的 `models.json`（`providers/<connectionId>/context/<hash>.json`，只含该模型的 `modelOverrides.<id>.contextWindow`），写一次、不覆盖，避免并发运行互相影响。`maxTokens` 不得超过有效窗口。

### 压缩与上下文状态

- 新增对话块 `kind: 'compaction'`：`{ ...blockBase, status: 'running' | 'completed' | 'failed', reason: 'manual' | 'threshold' | 'overflow', summary: string, tokensBefore: number | null, tokensAfter: number | null, error: string }`。`running` 为实时块；`completed` 来自持久化的 pi compaction 条目；`failed` 必须在重载后仍可见（service 追加自定义会话条目持久化）。旧的 `system` 块不再承载压缩摘要。
- `TaskSnapshot.context: { contextWindow: number | null; tokens: number | null; percent: number | null; compactions: number; compacting: boolean }`，新增事件类型 `context.update`（data 为同一结构），在每轮结束、压缩开始/结束、模型变化时发出。`tokens`/`percent` 未知（如刚压缩完）时为 `null`。
- 手动压缩：`POST /v1/tasks/:taskId/compact` `{ instructions?: string }`（≤ 2000 字符）；任务有运行中的 run 时返回 409；无可压缩内容时返回 409 并带原因。

## 阶段与任务

### P0 依赖升级（worker：P0）

- `@earendil-works/pi-ai`、`pi-coding-agent` 0.86.1 → 0.87.1，同步 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`。
- `pi-mcp-adapter` → 2.38.0（若已覆盖补丁内容则删除补丁）；`pi-subagents` → 0.72.1（重新生成仍需要的 `managedSettings` 补丁，核对 0.71 的 `subagents_enable` 与 worker 新上下文行为）；`pi-web-access` → 0.32.0；`pi-hermes-memory` 保持 0.9.9。
- `transcript.ts` 等穷举 switch 处理 `context_edit`（不产出对话块）。
- 验收：install、typecheck、lint、test 通过；隔离 service 可启动。

### P1 自动压缩（worker：service S、desktop D）

- S：按模型设置 `compaction.modelOverrides["provider/id"]`：`reserveTokens = max(round(0.15·W), min(16384, round(0.3·W)))`、`keepRecentTokens = min(20000, round(0.25·W))`，`W` 为有效窗口；父会话与子 agent 设置文件一致。
- S：监听压缩事件，产出 `compaction` 块与 `context.update`；压缩失败变为可见的 `failed` 块；溢出重试成功后隐藏被取代的失败回复（重载后亦然）；手动压缩路由。
- D：`compaction` 块渲染（默认折叠：“上下文已整理 · 约 X → Y tokens”，展开 Markdown 摘要；`running` 显示“正在整理上下文…”；`failed` 显示原因并提供“重试整理”）；进度胶囊在压缩中显示状态；token-rate 改为按 `compaction` 块判断；`/compact [重点]` 快捷命令与任务菜单入口；压缩两次以上的轻提示；中英文案。

### P2 上下文窗口档位与用量（worker：S、D）

- S：档位推导、查询/写入路由、`RunSnapshot.contextWindow` 冻结、按内容寻址的覆盖文件。
- D：`ModelConfigPopover` 的 Context 行在有两档时变为可钻取，子视图列出两档（窗口大小 + `long` 档计价提示 + “对此模型后续任务生效”），与 Effort 同样的禁用与焦点行为；快捷面板新增 `/context` 钻取；提供商设置行的范围弹层同样可用；触发器显示有效窗口；输入框旁上下文用量圆环（75% 警告色、90% 错误色，悬停说明“上下文接近上限时会自动整理”（小窗口模型的实际触发点早于 85%，因此文案不写具体比例））。

### P3 清理旧工具输出（worker：S）

- 在 `turn_end` 边界、用量 ≥ 60% 有效窗口时，用 `appendContextEdit` 把早于最近约 40k token 的较大工具输出替换为占位文本；预计节省 < 20k token 时不执行（避免无谓打破提示缓存）；`load_skill`、记忆类工具与子 agent 结果不清理；不改变原始记录与界面历史。

### Figma 同步（worker：F，在 D 完成后）

- 在项目 Figma 文件同步：模型选择器 Context 子视图（两档）、`Model picker 954:19478` 触发器、对话中的压缩标记三态、上下文用量圆环三态。复用共享库实例，不脱离实例。

## 验证

- 每阶段：`pnpm typecheck`、`pnpm lint`、`pnpm test`，新增或修改文件遵守 350 行上限。
- 运行验证（隔离实例，不触碰用户数据）：重开压缩前的旧会话；手动压缩与失败提示；子 agent 与 MCP 工具可用；渲染器预览检查 Context 两档、压缩块三态、用量圆环在窄/宽宽度下的表现。
- 已知限制：agent-service 目前无自有单测，pi 会话逻辑主要依赖类型检查与运行验证。

## 进度

- [x] P0 依赖升级（0.87.1；pi-mcp-adapter 2.38.0 去掉补丁；pi-subagents 0.72.1 重生补丁；pi-web-access 0.32.0）
- [x] C1 接口契约落地（compact 响应为 `{ ok: true }` 受理确认；`ProviderUpdateRequest` 不含 `contextTiers`，普通编辑保留已存档位）
- [x] P1 service / desktop（事件源为 pi `compaction_start`/`compaction_end`，覆盖记忆保存；溢出重试以 `replacement: null` 的 context edit + 后续压缩条目判定为已取代；子 agent 在创建后 `applyOverrides` 同一策略）
- [x] P2 service / desktop（窗口显示精度改为 `1.05M`；`--ata-status-warning` 放入 `packages/ui`）
- [x] P3 service（豁免 `load_skill`、记忆工具与 `subagent`；仅清理 ≥ 1k token 的旧输出）
- [x] Figma 同步（节点映射见 `docs/design-source.md` 2026-09-27 一节；会话菜单项与 zh-CN 变体未同步）
- [x] 集成验证（隔离 service + mock 模型 + 网页客户端，7 项全部通过：档位选择与持久化、自动压缩三态与用量圆环、失败与重试、手动压缩与 409、溢出恢复、zh-CN、320/420/640 宽度）

## 验证结果与遗留

- 验证中发现并已修复：`/context` 列表不显示当前档位（窗口改放描述行）；已被后续压缩取代的失败行仍可“重试”（只在最新一条压缩记录上提供）；圆环提示写死 85%；压缩后估算值不小于压缩前时显示为变大（改为不显示数字）。
- 拒绝原因本地化（后续修复）：压缩路由的 409 以错误码表达原因（`CompactRefusal`：`active_run`、`already_compacting`、`nothing_to_compact`、`compaction_unavailable`，并入 `ErrorCode`），桌面主进程把它作为结果返回，界面按当前语言提示；`error.message` 仍是 service 的英文说明。
- 真实环境验证（用户的 opencode 连接、`Space Bunny Free`、网页客户端连用户正在运行的 service）：拒绝提示为中文；运行中会话菜单“整理上下文”禁用；手动压缩带重点成功（约 43k → 7.1k tokens，摘要含重点说明，之后模型能基于摘要继续回答）。同时发现并修复：新任务首次运行完成后界面停在“处理中”——在途快照晚于已应用的事件返回并覆盖了完成状态（`service-tasks.ts` 现在丢弃早于该任务最新事件的快照并重新获取）。
- 已知缺口：取消手动压缩没有单独入口，只能停止任务；提供商设置行的档位选择、原生 Electron 窗口与桌面快捷面板窗口未在运行时复核；真实 provider 下的窗口锁定未用真实请求验证。
- 既有问题（与本计划无关，pi 0.86.1 同样存在）：非首轮消息要等模型开始回复才出现在对话中，原因是 pi 先通告消息后落盘，而 `live-transcript.ts` 按落盘会话重建视图。
