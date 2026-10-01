# 模型侧技能目录、按需加载与 `~/.agents` 只读访问

Status: Implemented — 2026-09-26 已实施并通过静态检查与脚本验证；未用真实模型端到端运行，未提交
Created: 2026-09-26
Approval: 2026-09-26 用户要求「帮我一步到位优化，不需要一层一层优化」，随后要求「把 grep/find/ls 也放开 ~/.agents，顺便更新设计文档」。

## Summary

问题来源：一次会话里用户问「你目前能识别到多少 skill」，模型把 3 个子代理当成技能回答，并声称「没有 `skill_manage`」。原因有三：

1. 模型看不到任何技能目录。pi 自带的 `<available_skills>` 被 `noSkills: true` 关闭（`apps/agent-service/src/skills/loader.ts`），替代的目录没有补上；只有用户用 `/` 选中的技能会以隐藏 `app-skill` 消息注入。
2. 系统提示没有提到技能，模型只能就近拿 `subagent list` 的结果凑答案。
3. 记忆扩展在运行时追加的策略里写着 “Do not request project, skill_manage, or session_search tools.”，点名了不存在的工具，把模型引向“技能管理工具”（`patches/pi-hermes-memory@0.9.9.patch` 中的 `src/desktop.ts`）。

本计划解除 `2026-09-23-composer-skill-chips-and-highlight.md` 的非目标「模型自主发现并加载未被选择的技能」，并落实 `2026-09-20-pi-subagent-skills-mcp.md` D5 原本的「description 注入、按需读取」意图，同时保留 09-23 的服务端确定性注入作为用户显式选择的路径。

## 调研结论

Agent Skills 规范与主流 harness 做法一致：常驻上下文的只有名称与描述，正文按需加载；用户显式点名与模型按描述自选两条入口并存；目录有预算，超出时先砍描述、再降级为只列名字，不静默丢弃；每个技能可以用 `disable-model-invocation`（或等价字段）退出模型自选。

| Harness               | 目录形态                              | 加载方式                        | 预算                                         |
| --------------------- | ------------------------------------- | ------------------------------- | -------------------------------------------- |
| Agent Skills 规范     | name + description + location         | 读文件或 `activate_skill` 工具  | 每项约 50–100 token                          |
| Claude Code           | Skill 工具的 `name: description` 列表 | `Skill` 工具                    | 上下文 1%，超出先砍描述                      |
| Codex                 | 开发者消息 `## Skills` 列表           | 读 SKILL.md                     | 上下文 2% 或 8k 字符，截断→去描述→省略并计数 |
| OpenCode / Gemini CLI | 系统提示 `<available_skills>`         | `skill` / `activate_skill` 工具 | 未设                                         |
| VS Code Copilot       | `<skills>` 列表                       | 工具或读文件                    | 15k 字符，超出只列名 5k                      |
| Hermes Agent          | 系统提示分类索引                      | `skills_list` / `skill_view`    | 降级为名字，不删除                           |

来源：[agentskills.io/integrate-skills](https://agentskills.io/integrate-skills)、[Claude Code skills](https://code.claude.com/docs/en/skills)、[Codex skills](https://learn.chatgpt.com/docs/build-skills)、[OpenCode skills](https://opencode.ai/docs/skills)、[Gemini CLI skills](https://geminicli.com/docs/cli/skills/)、[VS Code agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)、[Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)。

## 决策

- **D1 目录内容。** 与 `freezeRunSkills` 相同的合并目录（已安装版本 + `~/.atd/skills` + `~/.agents/skills`），取每个名称的最新版本，去掉 harness 禁用的技能和角色不允许的技能（沿用能力快照的规则 `roleAllowedSkills`）。按 `disable-model-invocation` 分为「可加载」与「仅限用户」。5 个内置产品技能都属于仅限用户。
- **D2 冻结。** 目录在运行冻结时计算一次，随 `RunMaterial.catalog` 传给会话。不固定目录里各技能的版本：运行期间被删除的技能加载时报错。
- **D3 模型侧呈现。** 系统提示的 `skill_catalog` 段（渲染为 `<skill_catalog>`），每次 prompt 由 `before_agent_start` 设置，不进会话绑定键。Pi 只在文本变化时写入系统提示补丁，压缩保留系统提示，因此不需要摘要比较或压缩后重发。两组都为空时不设置。原方案是紧跟用户消息的隐藏 `app-skill-catalog` 消息：它会被当作用户文本的一部分（例如翻译请求把目录当成待译内容），2026-09-30 废弃，旧会话里的这类消息由 `harness/retired-messages.ts` 从上下文过滤。
- **D4 预算。** 目录段不超过 8000 字符；描述截到 250 字符；仍超出时末尾条目只留名字，再超出则省略并注明数量；总数始终准确。目录字符计入运行上下文预算，与技能正文一起先于引用材料扣除。
- **D5 加载工具。** `load_skill { name }`，只在可加载组非空时进入主代理的工具白名单，子代理不继承，不经过权限关卡。按当前运行的冻结目录校验名称；仅限用户的技能返回错误并提示用户用 `/` 选择；已在上下文中的技能返回「已加载」说明；正文上限为上下文预算的 1/4；结果文本与 `/` 选择的 `<skill>` 区块同形。加载过的技能目录像 `/` 选择的技能一样可免确认读取。
- **D6 压缩补回。** `load_skill` 的成功结果与 `app-skill` 消息由同一个读取函数识别，压缩后在原有 `REATTACH_CHARS` 预算内补回。
- **D7 系统提示。** 说明技能是可复用的指令包、`/` 选择的技能已加载、目录中的技能可在任务明确匹配时用 `load_skill` 加载，以及子代理和已保存命令不是技能；目录只列出技能，不是待处理内容。
- **D8 记忆策略。** 删去点名不存在工具的句子，改为 “This app has no projects. Supported memory targets are user, memory, and failure.”。
- **D9 `~/.agents` 只读访问。** 主代理的 `read`、`grep`、`find`、`ls` 都可以访问 `~/.agents`，按 `read:outside` 走正常权限关卡，与 `~/.atd` 一致；写入仍被拦截；子代理的 grep/find/ls 仍只限任务目录。`~/.agents/skills` 下直接的符号链接（技能管理工具常把技能链接进来）以其目标目录作为额外只读根，更深层的链接不扩大访问范围；否则按真实路径比较时，这类技能会被判为目录外并被 ls 静默跳过。本条替代 09-23 计划中「`~/.agents` 被 `read` 工具拦截」的现状描述，以及方案 A 被排除的前提之一。
- **D10 桌面呈现。** 对话记录显示「加载技能 <名称>」一行，图标与输入框技能区块相同（`BookOpen`），归入研究类活动，默认折叠，展开时与 `read` 一样显示输出。

非目标：子代理继承或预加载技能（保持 `inheritSkills: false`）；给 ATD agent 定义增加 `skills:` 字段；技能的 `tools:` 声明仍不授予任何权限。

## File And Code References

- 目录：`apps/agent-service/src/skills/skill-catalog.ts`（冻结、预算、消息文本）、`apps/agent-service/src/skills/session-catalog.ts`（发送、去重、压缩后重发）、`apps/agent-service/src/skills/versions.ts`（`loadSkillCatalog`）、`apps/agent-service/src/skills/roles.ts`（`roleAllowedSkills`）。
- 加载：`apps/agent-service/src/skills/load-skill-tool.ts`、`apps/agent-service/src/skills/skill-message.ts`（`readCarriedSkills`）、`apps/agent-service/src/skills/session-skills.ts`。
- 接线：`apps/agent-service/src/run-freeze.ts`、`apps/agent-service/src/run-binding.ts`、`apps/agent-service/src/pi-session.ts`、`apps/agent-service/src/task-runner.ts`、`apps/agent-service/src/skills/run-skills.ts`、`packages/agent-contracts/src/tool-names.ts`（`LOAD_SKILL_TOOL`）。
- `~/.agents`：`apps/agent-service/src/service-fs.ts`（`userAgentsHome`）、`apps/agent-service/src/tool-proxies.ts`、`apps/agent-service/src/harness/search/confine.ts`、`apps/agent-service/src/harness/search/tools.ts`、`apps/agent-service/src/harness/search-tools.ts`。
- 记忆策略：`patches/pi-hermes-memory@0.9.9.patch`，`pnpm-lock.yaml` 中该补丁的哈希。
- 桌面：`apps/desktop/src/features/agent/transcript/tool-copy.ts`、`apps/desktop/src/features/agent/transcript/adapter.ts`、`apps/desktop/src/i18n/locales/{en,zh-CN}/tasks.json`。

## Validation

- `pnpm typecheck`：5/5 通过。改动文件 `oxfmt --check` 与 `oxlint` 通过，均不超过 350 行。
- 桌面 `vitest run src/features/agent/transcript`：3 个文件、12 个测试通过。agent-service 没有测试文件。
- 脚本验证（临时空 profile，真实 `~/.atd/skills` 与 `~/.agents/skills` 只读）：85 个可加载、7 个仅限用户，目录 7949 字符，末尾条目降级为只列名字，总数准确。`load_skill` 的五条路径（未知、仅限用户、已加载、超长、正常）与 `loadedSkillDirs` 均按预期。
- 搜索限制：任务目录为 `inside`，`~/.agents` 为 `outside`，`~/.ssh` 被拦截；子代理访问 `~/.agents` 被拦截；`ls ~/.agents/skills` 返回 83 项。
- 真实模型端到端（`opencode-go` / `space-bunny-free`，临时环境变量凭据，隔离服务实例，脚本 `tmp/skill-e2e/run.mjs`）：
  - 「你目前能识别到多少 skill」：回答 85 个可加载 + 7 个仅限用户，列出仅限用户的名字，未调用工具。
  - 「补注释，用合适的 skill」：调用 `load_skill` 加载 `comment-strategist` 并按其规则作答。
  - 「用 grill-me 审问方案」：`load_skill` 返回仅限用户错误，模型提示用 `/grill-me` 选择。
  - 「用 ls 列出 ~/.agents/skills」：触发一次 `read:outside` 确认（ls: ~/.agents/skills），放行后完成；该轮发现 26 个符号链接技能被静默跳过，据此补充了 D9 的链接根规则，并用脚本验证 83 项全部可见、`~/.ssh` 与链接目标的上级目录仍被拦截。
  - 同一任务 4 次运行只注入 1 条目录消息。
- 未做：启动 Electron 应用查看对话记录中的「加载技能」行。

## Risks

- 目录从非空变为空时，上下文中的旧目录消息不会撤回；此时 `load_skill` 已不注册，模型无法加载。
- 同一轮对同一技能的两次并发 `load_skill` 可能都加载。
- 名称超过 64 字符的技能可以列出和加载（工具参数上限 128，与 atd 与 `~/.agents` 的名称上限一致），但不符合 Agent Skills 规范的 64 字符建议。
- 目录字符每次运行都计入预算，即使目录未变化、未重新发送。
- 可加载组在空与非空之间变化时，工具白名单变化会重建会话（从同一会话文件），这是预期行为。
