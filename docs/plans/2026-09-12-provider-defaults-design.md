# 提供商与默认模型设计修订

日期：2026-09-12。范围：Figma 设计、交互约定与设计资产；本轮按用户确认同步设计稿和本计划，应用实现另行进行。

设计稿统一放在 01 · Product design · Flows & settings (Figma `project/1:251`)，与任务、命令和记忆流程共用一页；提供商位于 F1–F9，快捷键位于 G。页面合并保留原画板节点与原型目标，不改变本计划的能力和实现边界。

## 应用实现记录 · 2026-09-12

本次按用户“根据最新计划和设计稿落地实现”的请求同步应用代码。下文“设计契约”和早期差异是设计修订时的背景；本节记录当前实现。

- `electron/providers/` 拥有连接身份、加密凭据、配置修订、原生 Pi ModelRuntime、登录交互、模型目录与独立验证；`settings-store.ts` 保存 v2 多连接设置。v1 连接身份、模型引用和原有加密字节迁移保留，钥匙串暂时不可用不会删除连接。断开保留引用并清除凭据，不隐式迁移默认值。
- 提供商目录从已安装 Pi 的 40 个注册项生成，另加 llama.cpp、Ollama、LM Studio、vLLM 和自定义入口；数量不作为产品能力的固定约束。OAuth 的浏览器链接、设备码、手动码、提示与取消复用 Pi；API 连接的凭据按连接隔离，AWS/Vertex 环境凭据仅在明确保存该认证方式后使用。
- 当前 npm 包的 ModelRuntime 没有导出文档所述的 llama.cpp 注册项。因此应用使用其[官方 router 接口](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#multi-model-support)读取已加载/休眠模型和真实 context 大小，再注册给 Pi 调用；不自动下载、加载或卸载模型。普通兼容端点使用 `/models`，其他自定义协议使用手工模型定义。兼容目录缺少能力信息时明确展示可编辑的保守初始配置，不按名称猜能力。
- 新请求解析默认连接与该连接默认模型；固定命令和 Composer 支持跨连接明确选择。接受时冻结模型，出队与每次调用前重新校验连接/认证；默认值改变不会重写历史或队列。旧运行时不能把新配置凭据发送到旧端点。
- Providers 的本地模糊搜索复用已安装 cmdk 的 `defaultFilter`，保留连接顺序。共享 `ModelPicker` 分别提供连接内选择与跨连接选择；保存冲突保留草稿并提供重新载入，目录失败保留缓存与原选择。
- 设置窗口在 760px、480px 断点切换侧栏、顶部导航、抽屉；抽屉复用 Rhea Sheet（底层 Radix Dialog），从左侧滑入，关闭时退回左侧。共同标题/搜索排列、220px 字段下限、16/8px 表单节奏、滚动正文与固定页脚已用于提供商、命令、参数、记忆页面；导航移除 logo、头像与姓名。
- 指令生成组件 (Figma `project/1231:39739`)接入应用默认模型：只生成完整指令文本并验证 Mustache 引用。预览、重试、停止、错误和缺少默认模型均有反馈；Use instructions 只更新未保存草稿并提供 Undo。关闭/取消后忽略迟到结果，不创建任务、不执行工具、不学习记忆。
- 实现映射已回写 Figma 共享窗口、编辑器、Run settings、连接列表和指令生成组件的 usage description；既有主组件、变量、实例和画板保留。

验证：`pnpm check`（格式、TypeScript、Oxlint、现有 Vitest 13 项、生产构建）和现有 Electron 冒烟检查均已通过。随后按用户要求完成隔离 Electron UI 走查：设置页覆盖 36 个尺寸与页面组合，面板覆盖 320 / 420 / 640px 与短高；透明菜单和抽屉在原生明暗背景下检查。滚动区域统一使用 ScrollArea，标题与描述优先单行省略，具体修复与证据见[完整 UI 走查记录](../design-source.md#2026-09-12-完整-ui-走查与透明弹层修复)。未使用真实账户完成 OAuth、云端/本地模型调用或计费验证。

## 本次决定

应用选择一个默认提供商连接；每个连接独立保存自己的默认模型。新任务按“默认提供商连接 → 该连接的默认模型”解析。2026-09-13 按用户确认修订首次配置行为：尚无默认提供商时，首次保存已连接提供商的模型，自动将该连接设为应用默认；先选模型再完成登录同样适用。已有默认提供商时，修改其他连接的模型不切换默认提供商；切换提供商不覆盖其他连接的模型偏好。

启动时兼容旧配置：默认提供商为空且只有一个已连接、已保存模型的候选连接时，补全并持久化该默认关联；多个候选时保留空值，等待用户明确选择。已有默认引用即使失效也不自动替换。主界面 Composer 展示当前 Provider 的品牌图标与模型显示名称，悬停说明包含连接名称；读取新任务默认值与实际运行解析使用同一已保存关联。

- 提供商总览 (Figma `project/250:1337`)：顶部改为 `Search providers…` 模糊搜索输入框；各连接行右侧继续独立选择默认模型。取消顶部默认提供商下拉框及其说明区域。
- 连接操作菜单 (Figma `project/933:20523`)：从行尾 More 菜单选择 `Make default provider`。保存成功后，仅该连接名称旁显示 `Default` 标签；其他行不显示该标签。
- 当前默认连接菜单 (Figma `project/933:20290`)：首项显示禁用的 `Current default`，避免重复提交；Manage connection、Refresh models、Disconnect 保留原有含义。
- 搜索焦点 (Figma `project/323:1525`)、匹配结果 (Figma `project/981:29300`)与无匹配结果 (Figma `project/981:29310`)：展示已保存连接的过滤状态，搜索不修改默认值。
- 提供商内的模型选择 (Figma `project/976:25105`)：只显示 Anthropic 连接的模型。
- 独立模型偏好 (Figma `project/981:29320`)：Anthropic 改用 Opus 后，默认提供商仍为 ChatGPT / Codex。
- 未设置模型 (Figma `project/976:25180`)：OpenAI API 保留在列表中，选择默认模型前不能将其设为默认提供商。
- 完整接入目录 (Figma `project/929:16837`)：搜索与分类位于滚动列表外；支持账户登录、API keys、云服务及本地连接筛选。

## Pi 依据与实现差异

项目依赖为 `@earendil-works/pi-ai@0.85.1` 和 `@earendil-works/pi-coding-agent@0.85.1`，以仓库已安装包的文档和声明为版本依据。上游当前位于 [earendil-works/pi](https://github.com/earendil-works/pi)。

1. `pi-ai/dist/types.d.ts` 的 `KnownProvider` 包含 40 个标识，地区与套餐分支分别计数；这不是 40 家独立公司，也不是运行时提供商数量的上限。
2. `coding-agent/dist/core/model-resolver.js` 有 `defaultModelPerProvider` 建议映射，可用于第一次配置时的建议。用户保存的连接偏好不能被它覆盖。
3. Pi 的 [settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md) 保存启动时的 `defaultProvider` / `defaultModel` 一组值；应用另存每个连接的用户默认模型，再向 Pi 提交解析后的具体模型。
4. [Providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) 与 [Custom models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md) 区分原生提供商、认证方式、本地模型及自定义扩展。目录来自运行时注册信息、可用目录及已加载扩展，不能维护与 Pi 脱节的固定六项列表。
5. 当前应用仍保存单个 OpenAI / OpenAI-compatible 连接，worker 注册当前选中的 `app-provider`。本次 Figma 能力比应用现状更广；新增 provider、OAuth、模型目录和多连接默认值仍需实现。现有 safeStorage 凭据边界与任务快照约定继续适用。

## 数据归属与解析

下面是设计契约，不是已经实现的 TypeScript API：

| 所属对象     | 负责的值                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| 应用默认设置 | 一个可为空的默认连接身份                                                                     |
| 提供商连接   | 稳定 connection identity、Pi provider ID、显示名称、端点/认证配置、可为空的 default model ID |
| 模型引用     | connection identity + model ID                                                               |
| 本次运行     | 解析后的具体模型引用、来源及配置修订的快照                                                   |

同一个 Pi provider 可以有多个具名连接；例如工作 API key 与个人 API key 各自拥有模型偏好和凭据。OpenAI API 与 ChatGPT / Codex 分别对应 `openai` 与 `openai-codex`。Anthropic 的登录方式和 API key 也必须明确归属到所保存的连接。

沿用需求 C6 的统一策略解析入口。继承默认值时先解析连接，再解析其默认模型；固定命令或本次明确选择的模型继续按完整模型引用解析。接受请求时冻结选择，队列开始时重新检查当前凭据和可用性，不更换模型。修改设置不会重写已接受、排队或执行中的快照。

每次运行仅向其 Pi 运行时提供已解析连接所需的凭据；同类连接不能因 Pi provider ID 相同而共用用户偏好或覆盖对方的凭据记录。凭据留在主进程加密存储边界，按需注入运行时；UI、设计导出与任务快照不保存密钥。

## 行为与反馈

| 操作或状态           | 规则                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 搜索已连接提供商     | 顶部输入框只过滤已保存连接；不修改默认连接、模型偏好或凭据                                                         |
| 修改默认提供商       | 行尾 More → Make default provider；只改应用的默认连接指向，保留所有连接的默认模型                                  |
| 默认标签             | 保存成功后移动 Default 标签；标签归属于连接身份，不取决于搜索结果顺序或行的焦点                                    |
| 当前默认连接         | 菜单显示禁用的 Current default；不能再次设置同一连接，也不提供取消默认的隐式动作                                   |
| 修改行内默认模型     | 立即保存该连接的模型偏好；尚无默认提供商且该连接已连接时，同次保存将其设为默认；已有默认提供商时不切换             |
| 详情表单修改         | 跟随现有 Save connection / Save changes 提交；保存整个连接草稿及默认模型                                           |
| 保存偏好失败         | 保留原已保存值和 Default 标签，显示失败原因和重试入口；不将未保存的选择用于新任务                                  |
| 首次连接、尚无模型   | 凭据可以先保存；Make default provider 禁用并说明 Choose a default model first；行内模型入口仍可用                  |
| 尚无默认提供商       | 首次完成连接与模型配置时自动建立默认关联；旧配置仅有一个候选时启动补全；多个候选时提示明确选择，不用第一行充当默认 |
| 模型已下线或连接失效 | 保留名称和原引用并标记不可用；修复或明确重新选择，不自动切换 provider/model                                        |
| 目录刷新失败         | 保留缓存目录和已有偏好；空搜索结果与刷新失败分别反馈                                                               |
| 断开默认连接         | 明示新默认任务受影响；清除凭据后保留不可用选择供修复，或由用户明确选择替代连接                                     |
| 验证模型             | 独立的显式小请求，可消耗额度；不执行 Agent 工具，也不是保存凭据的前置步骤                                          |

搜索输入框的可访问名称为 `Search providers`；行内 Select 和 More 的可访问名称包含连接名称，例如 “Default model for Anthropic” 和 “Connection actions for Anthropic”。省略号的可见 tooltip 统一为 `More`。键盘操作、焦点、禁用状态和菜单选中标记继承 Rhea 对应 primitive。`Default` 标签表示已保存的连接偏好，不代表行被选中或连接可用。

模型菜单搜索范围严格限于当前连接；Composer 和固定命令的明确模型选择仍可以浏览多个连接，但不会修改应用默认值。

Azure 的默认模型使用 Pi 模型引用，deployment 映射属于该连接配置；Bedrock 保留其模型/推理配置 ID；Vertex 使用 ADC 或 service account。自定义连接的模型 ID、协议和能力配置仍归该连接。不能仅凭模型名称猜测能力或一律请求固定的 `/models`。

## 已连接提供商搜索

- 匹配保存的连接名称、提供商名称及已有别名；忽略大小写和首尾空白，支持子串及有序字符的模糊匹配。模型名称、凭据内容和未连接提供商不属于本输入框的搜索范围；新增连接仍从 Add provider 进入目录。
- 输入变化时在本地过滤当前连接列表，保留原列表顺序；清空输入恢复全部连接。搜索状态只属于当前设置视图，不持久化为应用偏好，也不触发模型目录刷新或认证请求。
- 默认连接被过滤掉时，不给其余结果补上 Default 标签，也不自动切换默认连接。图中 `anthr` 只显示 Anthropic，但已保存的默认连接仍是 ChatGPT / Codex。
- 无结果时保留输入内容，显示 `No matching providers`、简短说明和 `Clear search`；清除后焦点回到输入框。Esc 在输入框有查询时清空查询；不将空结果表现为尚未接入提供商或目录加载失败。
- 尚无连接时禁用搜索，保留接入空态和 Add provider 入口。连接名称过长时截断名称并提供完整名称提示；Default 标签、模型选择器及 More 的空间保持稳定。

## 目录覆盖

设计样例包含下面 40 个内置标识，以及 llama.cpp 和 Ollama / LM Studio / vLLM 自定义服务预设，共展示 44 项。上线后的名称、数量、认证选项与扩展入口由运行时生成；Figma 内数字仅为版本快照。

| Pi provider ID               | 展示名称                           | 认证入口                          |
| ---------------------------- | ---------------------------------- | --------------------------------- |
| `openai`                     | OpenAI API                         | API key                           |
| `openai-codex`               | ChatGPT / Codex                    | Account login                     |
| `anthropic`                  | Anthropic                          | Account login or API key          |
| `google`                     | Google Gemini                      | API key                           |
| `openrouter`                 | OpenRouter                         | Account login or API key          |
| `xai`                        | xAI                                | Subscription login or API key     |
| `deepseek`                   | DeepSeek                           | API key                           |
| `github-copilot`             | GitHub Copilot                     | Account login                     |
| `mistral`                    | Mistral                            | API key                           |
| `groq`                       | Groq                               | API key                           |
| `cerebras`                   | Cerebras                           | API key                           |
| `nvidia`                     | NVIDIA NIM                         | API key                           |
| `amazon-bedrock`             | Amazon Bedrock                     | AWS credentials or bearer token   |
| `azure-openai-responses`     | Azure OpenAI                       | Resource endpoint and API key     |
| `google-vertex`              | Google Vertex AI                   | Application Default Credentials   |
| `vercel-ai-gateway`          | Vercel AI Gateway                  | API key                           |
| `cloudflare-ai-gateway`      | Cloudflare AI Gateway              | API key · Account and gateway IDs |
| `cloudflare-workers-ai`      | Cloudflare Workers AI              | API key · Account ID              |
| `radius`                     | Radius                             | Account login or API key          |
| `huggingface`                | Hugging Face                       | Access token                      |
| `fireworks`                  | Fireworks                          | API key                           |
| `together`                   | Together AI                        | API key                           |
| `baseten`                    | Baseten                            | API key                           |
| `ant-ling`                   | Ant Ling                           | API key                           |
| `zai`                        | ZAI Coding Plan · Global           | API key                           |
| `zai-coding-cn`              | ZAI Coding Plan · China            | API key                           |
| `moonshotai`                 | Moonshot AI · Global               | API key                           |
| `moonshotai-cn`              | Moonshot AI · China                | API key                           |
| `kimi-coding`                | Kimi for Coding                    | API key                           |
| `minimax`                    | MiniMax · Global                   | API key                           |
| `minimax-cn`                 | MiniMax · China                    | API key                           |
| `opencode`                   | OpenCode Zen                       | API key                           |
| `opencode-go`                | OpenCode Go                        | API key                           |
| `qwen-token-plan`            | Qwen Token Plan                    | API key · Existing catalog        |
| `qwen-token-plan-individual` | Qwen Token Plan · Individual       | API key                           |
| `qwen-token-plan-cn`         | Qwen Token Plan · China            | API key                           |
| `xiaomi`                     | Xiaomi MiMo                        | API key                           |
| `xiaomi-token-plan-cn`       | Xiaomi MiMo Token Plan · China     | API key                           |
| `xiaomi-token-plan-ams`      | Xiaomi MiMo Token Plan · Amsterdam | API key                           |
| `xiaomi-token-plan-sgp`      | Xiaomi MiMo Token Plan · Singapore | API key                           |

llama.cpp 是 Pi 单独支持的动态本地服务；Ollama、LM Studio 和 vLLM 通过自定义 provider 配置接入。扩展注册的 provider 也进入同一目录，沿其声明的认证与配置能力展示；没有对应能力的入口不可伪装成已接入服务。

## 组件与资产

- 总览复用 Settings overview header · Rhea (Figma `project/1181:38808`)，与 Commands、Memory 共用标题／说明、搜索与主操作的排列；窄屏按钮随工具栏换行。搜索复用 `App / Command field · Rhea` 的 Text 输入框，连接列表复用 `App / Provider connection row · Rhea` 和 `App / Provider model controls`。旧 `App / Default provider · Rhea` 标记为被替代，不再用于总览。
- App / Provider identity · Rhea (Figma `project/1006:22689`) 统一品牌、连接名称、认证说明及 Default 标签；暴露名称、说明、品牌替换和 Default provider 布尔属性。响应式行使用该组合与模型／More 组合的连接实例，项目 Auto Layout 拥有换行；保留共享 Item 外观层，比对后清理旧 SLOT 副本。
- 名称保留 ItemTitle 的 Inter Medium 14px / 19.25px 行高，并在项目组合拥有的最小 20px 标题轨道内垂直居中；认证说明使用 Inter Regular 14px / 20px。名称单行截断，标签不收缩，统一行内间距与尾部操作位置。
- App / Provider connection menu content (Figma `project/1015:22940`) 提供 Available、Current、Needs model 三种状态，嵌入 `App / Service connection menu` 的连接弹层。菜单在 More 下方留 4px，尾部对齐，空间不足时上翻；缺少模型的禁用说明允许菜单行随内容增高。静态 Figma 评审帧改变尺寸或文案后须重算跨 SLOT 锚点，不能把其约束当成自动定位；应用实现复用菜单库的碰撞处理。
- 2026-09-12 深度间距复核：跨提供商的 `App / Model picker content` 三个状态统一 CommandInput inset，搜索表面与选项高亮左右均为 8px，输入框保留 32px；作用域模型菜单继续保留自身 4px 边界。Catalog warning 的 Refresh notice 使用 Fill，不能把固定 320px 提示放进 312px 内容区；320px 菜单下提示容器左右为 4px、文字左右为 12px，288px 窄宽已核对。源组件与当前消费者同步，详见[排查记录](../design-source.md#弹层内边距深度排查仅-figma)。
- `App / Provider connections · Rhea` 增加 No results 状态，复用既有空态布局、共享 Lucide / search-x 图标与 Rhea 按钮。模型菜单继续使用 `App / Provider selection content` 和 `App / Provider selection menu` 的连接内上下文；接入目录继续使用 `App / Provider catalog content`。
- 保留 Rhea Input / Select 32px 高、18px 圆角和菜单选项 14px 圆角。Default 标签保留共享 shadcn Badge 的引用，并按 [Rhea Badge 源定义](https://ui.shadcn.com/r/styles/radix-rhea/badge.json)在项目组合内适配：Secondary、20px 高、18px 圆角、左右内边距 8px、Inter Medium 12/16，使用语义 secondary / foreground 变量。More 操作与品牌图标保持原有组件引用。
- 新品牌标识继续来自 [Logos](https://logos.lndev.me/)，原始 SVG、固定来源版本与哈希在 `packages/ui/src/assets/brands/lndev/`。未确认该站有对应品牌的条目使用名称，不用相似名称的其他公司标识冒充。
- Pi 原生回退建议不等同于用户已经配置的默认模型。空值、失效值和保存失败必须按上面的契约处理。

## 二级页面标题

接入目录、认证步骤、云服务、本地或自定义连接、模型配置与连接详情统一使用 App / Settings subpage header · Rhea (Figma `project/1045:32910`)，与 New command 使用同一组合。顶部不再将文字 Back 独立放在标题上方。

- 标题行横向排列：28 × 28px Ghost / icon-sm 返回按钮、16px 共享 Lucide / arrow-left、8px 间距，以及 Inter Semi Bold 24px / 32px 标题；按钮与标题垂直居中。
- 说明可选，位于标题行下方 8px，使用 Inter Regular 14px / 20px。组合填满可用宽度并随内容增高；长标题换行，不挤压返回控件，也不增加固定空白占位。Desktop 保留内容 40px 内边距，窄屏遵循响应式模式；保留原表单分组间距。
- 返回行为沿用该步骤的上级页面，不提交草稿；连接目录返回提供商总览，连接配置或认证步骤保留各自路径。tooltip 为 `Back`，可访问名称包含返回目的；沿用现有 IconButton 的 hover、focus-visible 和 disabled 状态。
- Figma 在返回控件容器上保留导航，让嵌套按钮的视觉状态变化不覆盖返回目标。标题、说明和显隐使用组件属性；代码实现复用现有 `.editor-heading` 与 `IconButton` 的尺寸、语义颜色和状态。

此次同步覆盖 28 个提供商页面主组件状态和合并设计页中的 58 个二级画板，包括命令、参数、上下文与记忆子页。原 New command 画面保持一致；后续提供商实现遵循此标题约定。本轮仍限于 Figma 与 plan。

## 设计验证范围

提供商总览、目录、连接步骤、模型与 More 菜单同时遵循 [全界面响应式约定](2026-09-10-general-agent-requirements.md#2026-09-12--全界面响应式布局仅-figma)：≥760px 侧栏、480–759px 顶部导航、<480px 抽屉；全部移除 logo、头像和姓名。宽屏保留 40px 内容 inset，窄屏左右 16px；身份与模型操作自动换行，弹层限制在窗口内并滚动。已核对模型名称和 Default 标签在迁移及模式切换后保留。组件、样例和断点见 响应式评审区 (Figma `project/1117:35919`)。应用实现仍属后续同步范围。

本轮核对总览搜索框、Default 标签、当前默认菜单、可设为默认菜单、未选模型禁用原因、搜索焦点、匹配与无匹配结果，以及长名称和模型菜单锚点。保留默认 Anthropic / LM Studio、独立模型更新、连接失效等既有状态中的连接名称、品牌与模型偏好。画板按功能区域整理，搜索状态替换原默认提供商下拉菜单的评审画板，沿用原链接。

关键路径使用固定数据制作可点击评审帧：从总览点击搜索框后，A 展示 `anthr` 匹配样例，Z 展示 `zzzz` 空结果，Esc / Clear search 返回未过滤总览；该快捷跳转只用于评审，不是产品输入行为。More 菜单的 Make default provider 跳转至对应默认标签状态。任意输入的模糊匹配、实时认证、动态目录、实际持久化及所有状态组合属于后续实现，不能把 Figma 示例跳转作为生产行为。

后续应用工作仍需实现多连接身份与持久化、应用默认连接到连接默认模型的解析，以及本计划规定的搜索、行内标签和菜单提交行为；现有单连接表单不具备这些能力。本轮未修改应用代码，不启动应用运行时，也不运行应用构建、类型检查或测试；仅检查设计和本计划的内容与格式。
