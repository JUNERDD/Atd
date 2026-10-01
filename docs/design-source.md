# 设计来源与实现记录

更新日期：2026-09-19。当前入口为 [01 · Product design · Flows & settings](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1-251)。用户已授权界面、真实 Agent 与持久化一并实现，并授权使用独立数据目录验证 Electron。

Agent 流程与 Providers / Shortcuts 设置已合并到同一设计页：[统一导览](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=577-11193)串联 A–E 任务、命令和记忆，F1–F9 提供商，以及 G 快捷键；Q1/Q2 保留视觉验收和渲染参考，Z 保留原型内部状态。原画板节点、组件引用和原型路径继续保留。本次页面合并未修改应用代码。

## 设计与组件映射

通过云端 Figma MCP 读取画面、主组件、变量、样式与截图。项目画面与适配组件保留在 [ai 项目文件](https://www.figma.com/design/PROJECT_FILE_KEY/ai)；共享 Radix / Rhea 控件与 Lucide 实例保留 [shadcn UI kit](https://www.figma.com/design/UI_KIT_FILE_KEY/shadcn-ui-kit-community-edition--Community-) 连接。本次没有修改共享库。

以下代码路径相对于 `apps/desktop/src/`。

| 设计源                                                                                                                                                                                                                                                                                                                                                                                                          | 代码拥有者                                                                                          | 实现内容                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Panel header](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=71-112)、[Composer](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=72-150)                                                                                                                                                                                                                                        | `App.tsx`、`components/composer.tsx`、`features/agent/use-task-panel.ts`                            | 新建、历史、设置、草稿、发送、停止与后续消息设置                                     |
| [任务执行](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=622-3727)、[会话轮次](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=693-4071)                                                                                                                                                                                                                                        | `features/agent/conversation.tsx`、`tool-activity.tsx`、`task-request.tsx`                          | Pi 消息、真实工具步骤、输入/权限确认、队列、停止与中断恢复                           |
| [Command management](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=373-1416)                                                                                                                                                                                                                                                                                                                   | `features/commands/command-settings.tsx`、`command-editor.tsx`                                      | 同构示例与自定义命令、Run / Switch / More、版本冲突、复制、删除                      |
| [指令编辑器](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=417-1716)、[变量选择器](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=439-2067)                                                                                                                                                                                                                                    | `features/commands/instruction-editor.tsx`、`instruction-extensions.ts`、`variable-picker.tsx`      | 高亮、光标处插入、变量说明、未启用来源的配置入口                                     |
| [参数字段](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=410-1982)、[参数定义](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=414-1817)                                                                                                                                                                                                                                        | `features/commands/parameter-editor.tsx`、`parameter-field.tsx`、`features/agent/command-input.tsx` | 文本、数字、选项、布尔字段；共用校验、默认值与运行预览                               |
| [文件结果](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=433-2044)                                                                                                                                                                                                                                                                                                                             | `features/agent/task-files.tsx`                                                                     | 文件信息、路径、打开、显示位置、复制、继续使用、重新关联                             |
| [Memory item](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=339-1153)                                                                                                                                                                                                                                                                                                                          | `features/memory/memory-settings.tsx`                                                               | Hermes 记忆列表、搜索、修改、删除与暂停学习                                          |
| [Plugin card · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1610-75888)、[Plugin kind tabs · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1614-74934)、[Plugin item row · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1590-66093)、[Plugin sub-page · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1593-66734) | `features/service/*`（插件卡片列表、插件详情 Tabs、安装页）                                         | 以插件为条目的扩展设置：来源徽标、启用开关、内容摘要、安装预览、只读条目与复制到个人 |

上述项目主组件的 usage description 已同步代码映射。Figma 原型继续使用固定样例表达有限状态，应用中的数据与执行状态来自运行时。

## 视觉约束与最新修正

- 采用仓库的 `b27GcrRo`：Radix / Rhea、Inter、Neutral、Lucide；控件复用 `packages/ui`，按钮、输入框、选择器与菜单保持各自变体的几何与状态。
- 面板默认 420 × 580，标题栏 48px 加 1px 分隔线。macOS 的外部圆角、材质、边缘与阴影由原生 HUD 窗口拥有；渲染层保持单一共享表面填充，不叠加 CSS 窗口描边或阴影。
- 按用户反馈移除会话 `margin-top: auto`。短对话首条消息从标题栏下方 20px 开始，Composer 固定在底部；长对话滚动至最新内容由滚动逻辑负责。
- [共享会话说明](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=694-17333) 与 [短回复示例](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=796-15567) 已同步顶部排列。长内容原型中展示“滚动至最新”的有限状态不代表运行时垂直布局规则。
- 已检查实际 Electron 内容截图及白色 / 蓝色背景上的 OS 合成窗口，覆盖四角、边缘、阴影和原生材质。证据在 `apps/desktop/.artifacts/agent-result-top-aligned.png`、`agent-native-contrasting.png`。
- 工具步骤行不绘制任何自身背景：折叠、hover 与展开（`aria-expanded`）都保持透明，hover 只保留指针光标，展开状态由旋转的箭头承担（`features/agent/agent.css` 的 `.tool-heading`）。[Tool activity](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=774-4064) 的 Toggle activity 同样没有行填充，两侧一致。
- 滚动条不再压在窗口边框上（2026-09-19）：面板内容滚动区（自身带 `.panel-content` 的 ScrollArea 与 `.conversation`）的纵向滚动条改为向面板内侧让出 4px（`apps/desktop/src/styles.css` 对 `[data-slot='scroll-area-scrollbar'][data-orientation='vertical']` 设置 `margin-right`；Radix 用内联样式固定滚动条位置，`right` 不可覆盖）。历史列表保留自己已有的 4px 内缩（`-mr-3` 加 `gutter`），命令列表因 `Command` 自身内边距落在 8px，消息卡片与代码块内的滚动条保持卡片边缘；消息列 16px 内边距与列宽不变。Figma 的会话画板（`693:4071` 等）只使用 `overflowScroll`、未绘制滚动条，因此本次只改代码与文档。

### 设置二级页标题统一

用户确认以 New command 的「左箭头 + 标题同一行」为准。提供商接入、连接详情、命令与参数编辑、上下文来源、记忆编辑及独立删除确认页共 58 个画板，统一复用 [App / Settings subpage header · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1045-32910)。一级设置页保留各自总览标题。

返回控件复用 `App / Icon button` 的 Ghost / icon-sm：28 × 28px，连接共享 `Lucide / arrow-left` 的 16px 图标；与 Inter Semi Bold 24px / 32px 标题相距 8px，垂直居中。可选说明使用 Inter Regular 14px / 20px，与标题行相距 8px。组合 Fill 宽度、Hug 高度，长标题自然换行；Desktop 保留设置内容 40px 内边距，窄屏遵循响应式模式。代码对应 `features/commands/commands.css` 的 `.editor-heading` 与 `components/icon-button.tsx`。

组件暴露标题、说明、说明显隐及嵌套返回按钮。原型导航由返回控件的容器承担，避免按钮状态切换覆盖返回目标；tooltip 统一为 `Back`，可访问名称说明返回的上级页面。保留既有导航，并补齐记忆编辑、独立确认页及 Anthropic 连接详情遗漏的返回入口。此次仅修改 Figma 与文档，提供商功能的后续实现沿用 [提供商计划](plans/2026-09-12-provider-defaults-design.md#二级页面标题)。

### 操作提示文案

图标操作的 tooltip 使用简短动作，不重复行内容、对象名称或页面上下文：省略号统一为 `More`，其他操作使用 `Run`、`Edit`、`Remove`、`Delete`、`Copy`、`Back`、`Insert`、`Configure`、`Move up` / `Move down`。`IconButton.label` 提供可见提示，`aria-label` 按需保留命令、参数、记忆内容或返回目标，方便屏幕阅读器区分按钮。文件操作保留 `Copy path`、`Show in folder`、`Attach latest version` 等必要区别。用于查看被截断的文件名、模型名和说明的完整值提示继续保留；不可用提示简明说明状态。

### 表单分组与间距

2026-09-12 按用户截图修正 25 个命令、参数和上下文编辑画板，并同步命令运行输入页与字段宽度评审。普通命令字段／分组之间使用 16px，标签到控件、说明和变量快捷入口之间使用各自分组内的 8px。保留 Rhea 标签 14px / 14px、32px 控件和输入／快捷键共享组合；提供商的 24px 大分区、选项编辑的 12px 组内行距继续按各自组合使用。

15 个命令画面复用 [App / Command run settings · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1062-33204) 的展开／收起变体。展开入口到内容为 16px；Model／Memory 在宽度充足时并排，Allowed tools 单独组成标签与开关组。复用既有 `Spacing / 16`（Standard）与 `gap/layout`，保留按钮、Select、Switch 的连接及原型目标。编辑页标题、滚动内容和页脚之间为 16px；Desktop 的内容 inset 为上／右／下／左 40／40／32／40px，窄屏值由响应式模式拥有。

[输入选项](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=440-6995) 的新增参数入口与列表标题共用一行，参数列表 Hug 高度，行距 8px；第五项不再被固定高度隐藏。滚动由表单区域承担，页脚位置固定。[指令编辑器](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=417-1716) 保留 96px 最小高度并随内容增长，防止长指令溢出到说明文字。已检查展开／收起、长内容、字段错误、变量弹层、五项参数和窄字段截图，并读回布局与原型引用。

此次按用户约定只修改 Figma 与 plan。后续实现需同步 `run-settings.tsx` 的展开间距和组合、`input-options.tsx` 的列表标题操作，以及指令编辑器的内容高度；现有代码的 `pt-3` 和运行设置排列尚未按本次设计调整。详见 [计划中的表单间距修正](plans/2026-09-10-general-agent-requirements.md#2026-09-12--表单间距修正仅-figma)。

### 设置页组件归属统一

2026-09-12 按用户要求统一优化 Figma，并同步 plan。此前 sidebar 虽然全部是实例，8 个主变体仍保留旧文案，55 个 Providers 页面另有文字覆盖；连接了图标或按钮也不能代替其外围布局的复用。

- [Settings sidebar](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=256-1024) 的四项固定文案改由 `App · Controls / Content/Settings navigation/*` 字符串变量拥有。清理 55 处旧文案覆盖后，当前 93 个设置／菜单画面统一显示 Providers、Commands、Memory、Shortcuts。24 个变体覆盖四个 Tab、两种 Hover 和 Sidebar／Top／Drawer 布局；全部移除 logo、头像和姓名，保留原生窗口控件。页面只配置导航状态、布局和目标。
- [Settings editor layout](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1093-34262) 与 [Settings editor footer](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1093-34242) 替代 25 组复制的编辑页与页脚。主组件统一拥有响应式 inset（Desktop 为 40／40／32／40px）、16px 分区间距、共享二级标题、有界垂直滚动 SLOT，以及滚动区外的页脚。各页保留自己的表单、反馈、操作文案、禁用状态和原型目标。
- [Command identity](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1093-34209) 替代 15 组独立的名称／描述列。当前响应式版本使用随标签一起换行的字段列：每列最小 220px，列／行间距 16px、标签到控件 8px，可用宽度小于 456px 时堆叠。固定标签绑定文案变量并在最小列宽内保持单行，值和状态通过暴露的 Command field 实例编辑；更长的本地化标签需堆叠或使用共享标签／控件轨道，不能单独偏移输入框。
- 131 个独立共享库按钮迁入既有 [Settings action · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=907-17188)，统一 Label、前置图标、Primary／Outline／Ghost 与 Default／Hover／Focus／Disabled。保留连接的共享库外观层和 Lucide 图标；项目组件直接拥有标签属性，因为共享按钮源未提供文本属性。状态切换由项目组件负责，避免内层跳回共享库外观；禁用透明度只在整个按钮应用一次。
- 39 个独立输入框迁入既有 [Command field · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=410-1982)。Text 增加 Value／Placeholder 内容变体并覆盖五种交互／校验状态，复用共享 Input 的 Value 属性；独立搜索或外部标签组合关闭 `Show label`。32px 高度、18px 圆角与 token 由源组件拥有。

页面导航放在按钮外的透明 Auto Layout 动作容器，按钮实例只继承组件状态反应，避免 hover 切换覆盖点击目标。产品页的 178 个按钮导航保留原目的地；组件定义与组件页 QA 只提供外观参考。

保留当前批准的 hover：Ghost 白色 10%、Outline 白色 4.5%、Primary 为 `primary/80`；焦点使用 ring 边框与 3px、30% 的焦点环。未修改共享 shadcn 文件。组件页新增 [09 · Shared settings layouts](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1093-34208)，记录使用方式及宽窄窗口、换行和状态样例。

已复核标准编辑页、Memory、五项参数、长指令、校验错误、按钮及输入框状态；早期控件迁移的标准命令页与 Memory 截图一致。后续响应式修正允许窄字段堆叠，760 × 560px 窗口通过有界正文滚动保留页脚。产品页保留 26 个分区和 25 个原型起点。本条修正仅涉及 Figma 与文档，应用共用编辑布局的后续同步见 [组件统一计划](plans/2026-09-10-general-agent-requirements.md#2026-09-12--设置页组件统一仅-figma)。

### 命令菜单内边距归属（仅 Figma）

2026-09-12 复核 [命令操作弹层](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=380-3063)：实际内容已有 4px 内边距，与 `packages/ui/src/components/dropdown-menu.tsx` 的 `DropdownMenuContent p-1` 一致，并非零内边距。问题是这 4px 位于材质 SLOT 内的独立 Frame；外壳和菜单项虽然连接了组件，完整动作布局仍可能由各实例独立保留。

[Command actions menu · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=487-11060) 的 Enabled／Disabled 主组件现在直接拥有绑定既有间距变量的 4px Auto Layout padding 和五个连接菜单项。`App / Popover surface · Rhea` 继续连接共享库，仅作为铺满组件的材质层，其内容 SLOT 留空。两个产品实例的旧内容 Frame 已清理，九个点击目标、禁用 Run 的 50% 透明度及无动作状态保留。菜单行仍为 32px 高、左右 8px／上下 6px 内边距和 14px 圆角；没有套用通用 `PopoverContent p-4` 的 16px 规格。

实测临时调整源组件 padding 后，两处产品实例同步重排，随后恢复正式 4px；Enabled／Disabled 在 192、224、288px 菜单宽度下的六项原生布局检查通过。默认 224×168px，首行距顶部和左侧均为 4px，末行距底部为 4px；材质始终铺满。启用态整个画板的前后 PNG 完全一致，禁用态另已视觉复核。这次修正的是布局归属，不宣称先前已有数值漂移。当时只确认其余 16 个相关产品弹层拥有连接的内容组件，没有证明它们的累计内边距正确；后续发现与修正见下文深度排查。旧版菜单仅在已弃用源与 QA 中保留。使用说明、[项目 plan](plans/2026-09-10-general-agent-requirements.md#2026-09-12--全界面响应式布局仅-figma) 和 AGENTS.md 已同步。

### 弹层内边距深度排查（仅 Figma）

2026-09-12 根据 [变量补全实例](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1123-43441) 再次核对主组件、实际材质、SLOT、内容、分组和高亮边界。这次问题写在主组件内部：外层四边 4px，Suggestion group 又额外添加左右 4px，实际高亮边距成为上 4px、左右 8px。组件连接正常会把错误一起传给消费者；此前仅检查连接和单层 padding 的验收不充分。

| 发现                     | 源组件修正与当前结果                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 补全高亮左右多出 4px     | [Variable menu content](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=507-4022) 的 Suggestions 只保留根组件四边 4px，选项组不再叠加水平 inset。首行高亮到材质上／左／右均为 4px，选项与底部提示文字的左边线均为 12px。                                                                                  |
| 补全短高时整体裁切       | [Command variable suggestions](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=484-2844) 的材质、SLOT、内容共同 Fill 受限高度；仅选项组滚动，底部提示 Hug 并保持可见。由 18px 圆角材质裁切内容，取消产品实例外层方形滚动裁切。320px 长内容 QA 保留 226px 高度，清除内部固定高度覆盖，使其缩高时也能重排。 |
| 模型搜索框与选项错开 4px | [Model picker content](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=954-19478) 的 Default、No results、Catalog warning 均增加原生 CommandInput inset 容器，保持连接的 32px 输入框；搜索表面与选项高亮左右均为 8px、宽度相等。Composer 中的现有实例继承更新。                                           |
| 刷新失败提示右侧越界 4px | [Codex catalog warning](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=964-19967) 的 Refresh notice 从固定 320px 改为 Fill。在 320px 菜单内占 312px，左右外边距均为 4px，提示文字左右均为 12px；原失败画面已继承。                                                                                       |

完整可搜索变量选择器继续使用 Rhea Command 的 8px 搜索／选项高亮横向边距；行文字 16px 与底部提示文字 12px 来自不同用途的明确组合，不统一改成相同数值。DropdownMenu／Select 的 4px 边界、Tooltip 的上下 6px／左右 12px 也保留各自规格。

独立复核覆盖 25 个源／评审弹层和 18 个产品弹层，共 160 个菜单行外观层，未发现剩余行外观尺寸错配或横向区域越界；产品动作目标均可解析。另核对 36 个 Tooltip 实例，文字四边符合其规格。补全菜单验证 192／288／460px 宽度和 96／120px 短高，另在实际产品视口及 320px 长内容 QA 上验证高度传递并恢复评审尺寸；模型三个状态和刷新提示均验证 288px 窄宽。已检查实际画面、细节和短高截图，临时实例均已清理。

本轮按既定范围只修改 Figma 与文档。`instruction-theme.ts` 仍保留补全列表 `padding: '4px 8px'`，应用尚未同步本次 4px 补全边界及滚动／页脚调整；不把 Figma 修正当作运行时完成。后续同步要求见 [项目 plan](plans/2026-09-10-general-agent-requirements.md#2026-09-12--弹层内边距深度排查仅-figma)。

### 全界面响应式布局（仅 Figma）

2026-09-12 按用户要求覆盖各个尺寸，并将小屏抽屉及无 logo／账户信息的导航规则写入 [AGENTS.md](AGENTS.md#responsive-layouts)。[响应式组件与评审区](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1117-35919) 集中展示导航、编辑器、各设置模块、变量弹层和任务浮窗。

| 可用窗口宽度 | 导航布局         | 内容处理                                                       |
| ------------ | ---------------- | -------------------------------------------------------------- |
| ≥760px       | 208px 侧栏       | Desktop inset：上／左右／下 40／40／32px，内容宽度最多 1000px  |
| 480–759px    | 可换行顶部导航   | Compact inset：16／16／16px，字段与操作区按可用空间换行        |
| <480px       | 菜单按钮打开抽屉 | 同 Compact inset；抽屉提供选中项、关闭按钮、遮罩和 Escape 关闭 |

[Settings window layout · Responsive](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1119-36110) 统一拥有窗口布局、导航和两个原生 SLOT：正文与视口内弹层。91 个原设置窗口与两处旧命令菜单载体均已迁入，共 93 个画面。两处菜单入口改为完整窗口状态导航，保留原画板 ID、菜单操作和返回目标。普通侧栏仍透明，所有布局均无 logo、头像或姓名。

抽屉在真实蓝色壁纸上复核半透明、背景模糊与共享选中色。窗口独占 Glass 80% 底色；抽屉独立表面复用 `surface/settings-content` 10% 局部材质并施加 40px 背景模糊，导航本身透明，选中态沿用 Glass 白色 12%。有效 30% 的遮罩只覆盖抽屉外区域，避免窗口、遮罩与抽屉三层底色叠加成近乎不透明。表面作为导航的同级节点保留变体间相同的导航层级，避免切换时丢失选中 Tab。[真实壁纸评审](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1187-38838) 展示关闭与打开两种状态。

`App · Responsive` 使用 Desktop／Compact 模式。内容的三个间距变量别名到已有 token，另一个布尔变量控制窄屏下不再适用的模型列表列标题；BOOLEAN 使用 API 支持的默认 scope。原生窗口控件另有横向／纵向 inset：Desktop 为 0／0px，Compact 为 12／4px，只作用于侧栏控件行，使抽屉打开／关闭时的三灯位置一致，保留桌面位置及导航行的内边距。名称／描述、Input／Shortcut、运行设置、目录筛选、连接校验和页脚使用原生换行；长表单／列表放在有界滚动正文，页脚及任务 Composer 保持可达。保留 Rhea 控件尺寸、字体、圆角与分组间距。

提供商行和命令行由各自主组件拥有响应式布局，继续连接共享 Item 外观层、品牌／Lucide 图标及项目控件。保留模型值、Default 标签、命令标题与说明、快捷键显隐及操作目标；比对后清理旧插槽副本。18 个设置弹层均受窗口范围和滚动容器约束；49 个任务浮窗及 8 个边界状态卡片使用伸缩、换行或有界滚动。

[变量选择器](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=439-2067) 的三个 Scope 统一使用固定头尾与中间选项滚动区。弹层表面、内容 SLOT 和实例一起 Fill 可用高度；视口裁切沿用表面的 18px 项目适配圆角，避免旧的高菜单被方形滚动外框截断。四处产品弹层与小屏 QA 已同步，16 个尺寸检查通过，标题、搜索、Done 和底部提示保持可见。

[Settings overview header · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1181-38808) 拥有共同的标题／说明与管理工具栏，Toolbar 原生 SLOT 保留各页的搜索状态与按钮，消费者在其下方以 16px 间距衔接正文。标题到说明为 8px，标题区到工具栏为 16px；工具栏列距 12px、换行间距 8px，搜索最小 180px，主操作 Hug 并在窄屏换到搜索下方。Memory 搜索位于 Learn automatically 之前。Top／Drawer 导航下内边距为 8px，Compact 正文上 inset 为 16px，避免两个容器叠加过大的留白。

字段的内部文字区使用 Fill 与单行末尾截断，保留完整文本值和 Input 的左右 10px 内边距；Select 保留自身变体的内边距。提供商行与命令行的共享 Item 外观层从行的原点覆盖完整宽高，布局由内容拥有；不以旧外观层的固定高度裁切或偏移行内容。总览已同步 32 个产品消费者、4 个提供商源状态和 3 个总览 QA。553 个输入视口与 313 个 Input 几何检查通过，93 个产品列表行与外观层边界完全一致；旧源 QA 有一处 0.25px 原生取整差异，未发生可见裁切。补充截图标注项已完成，详见 [项目 plan](plans/2026-09-10-general-agent-requirements.md#2026-09-12--全界面响应式布局仅-figma)。

总览重排后的 12 处静态菜单已按真实触发器重新定位，使用现有 DropdownMenu／Popover 的 4px 间隔与尾端对齐；空间不足时上翻并限制在视口内。760、1000、1280px 与 320px 有界呈现共完成 48 项显式重排检查。**这些静态菜单不能跨 SLOT 自动跟随正文高度变化**：例如说明在 760px 换为两行时，锚点比 1000px 下移 20px；改变尺寸或文案后须重新计算。MAX／STRETCH 约束只处理自身分支，不能将其作为自动锚定的证明。Figma 原型另支持相对触发节点的 [`OVERLAY` 定位](https://developers.figma.com/docs/plugins/api/Action/)，但本次保留既有完整窗口评审帧及目标，不声称已迁成该机制。应用同步须使用已有菜单／弹层库的动态定位与碰撞处理。

基础迁移阶段的结构检查覆盖 93 个设置画面的 320×400、480×560、760×560、1000×720、1280×900，49 个浮窗的 320×400、420×580、640×800。修复发现的空状态、目录操作和校验行溢出；另检查 479／480、759／760 两侧、抽屉开关和状态往返，正文及选中 Tab 保持一致。最终引用复核包含隐藏与远程嵌套实例：28,508 个实例、371 个主组件引用（83 个远程）和 112 个 NAVIGATE 目标均可解析；93 个产品设置窗口仍共用响应式窗口主组件。产品页保留 26 个分区和 25 个原型起点。代表性渲染覆盖窄屏编辑器、各设置模块、菜单、抽屉及任务浮窗。

Figma **不会随宽度自动切换变体**：评审时按上述断点显式选择 Layout，变体内部由原生 Auto Layout 重排。固定样例原型不等于应用响应式实现；本次未修改应用代码、启动运行时或增加测试。后续应用同步与焦点管理要求见 [响应式计划](plans/2026-09-10-general-agent-requirements.md#2026-09-12--全界面响应式布局仅-figma)。

### Hover 与交互状态复核

用户确认保留半透明效果，统一同类控件规则，并要求 hover 再淡一些。常规 Ghost hover 从白色 15% 降至 10%，由 `--ata-surface-ghost-hover` 对应 Figma `surface/ghost-hover` 独立控制；标题栏、快捷命令、命令导航及同类操作共用这一值。原生背景材质仍会影响最终像素明暗，输入底色和展开、按下态继续使用原有 `input`。

| 控件与状态                   | 代码与 Figma 约定                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ghost hover、命令导航活动项  | `surface/ghost-hover`，白色 10%；cmdk 的活动项表示当前指针或键盘目标，不是持久选择。                                  |
| Ghost 展开、任务页按钮按下态 | `input`，白色 15%；任务按钮保持 Ghost，展开或按下时移入指针不削弱该状态。键盘焦点继续使用原有 ring。                  |
| 描边按钮与变量快捷按钮       | 默认透明，hover 为 `input/30`，白色 4.5%；变量按钮采用 Outline / sm、28px、14/20 Regular，移除覆盖 hover 的局部背景。 |
| 命令管理行、参数行           | 整行 `muted/50`，嵌套动作继续使用 Ghost；Run、Switch、More 与参数动作的位置不随 hover 改变。                          |
| 下拉菜单、Select 与变量选项  | 保留 Rhea 的 `muted/accent` 活动色和 14px 行圆角；Figma 的变量 Hover / Focus / Selected 对齐实际活动选项语义。        |
| 菜单与变量补全浮层           | `popover`（#0c0c0c 80%）与 20px 模糊；移除菜单局部 `bg-card`，补全不再使用 One Dark 配色。                            |
| 输入选项                     | 通过 Button ghost/xs 组合原生 details/summary，具备 hover、展开色、键盘焦点环，保留来源配置后的展开与聚焦。           |
| 主按钮                       | hover 使用 `primary/80`；修正 Figma 主图标按钮的 100% 填充，发送、停止、继续实例继承更新。                            |

变量文字共用 `--ata-syntax-variable`，对应 Figma `syntax/variable`。补全的标题与说明共用 `command-variables.ts`，状态和插入继续由已安装的 CodeMirror 负责，通过其 [theme API](https://codemirror.net/examples/styling/) 适配菜单样式。没有新增依赖或替代补全引擎。对照了 [Rhea Button registry](https://ui.shadcn.com/r/styles/radix-rhea/button.json)；Ghost 采用用户确认的半透明项目适配，并按最新反馈将 hover 调淡，不用最新 registry 重置项目样式。

窄窗口验收另发现变量弹层在 760 × 620 下超出窗口底部 35px。弹层现在使用 Radix 提供的实际可用高度与 8px 碰撞内边距，保留标题、搜索和底部提示，仅收缩并滚动选项列表；不压缩选项本身。该约定同步至 Figma 变量选择器的 usage description。

云端复核了组件页全部 25 个普通 Hover 变体、禁用 Hover、侧栏状态及另两个资源页；实际实例读回确认共享库连接保留，相关原型实例继承更新。隔离 Electron 检查覆盖首页、命令浏览器、管理列表、变量按钮/选择器/补全、Select 与记忆确认框，另验证键盘插入、来源配置聚焦、长名称/空快捷键、禁用动作。状态记录和截图位于 `apps/desktop/.artifacts/hover/`；`final-native.png` 是白色 / 蓝色背景上的 OS 合成窗口。

本轮调淡已在更新后的隔离目录包中复核 35 个状态，记录为 `subtle.json` 与 `subtle-*.png`。确认同类 hover 为白色 10%，按下和展开保留 15%，键盘焦点环可见；同时修正原生 summary 展开后被 hover 覆盖的样式优先级。

## 运行时与数据归属

`apps/desktop/electron/agent/` 实现窄类型 IPC、单写入者元数据、不可变运行快照、执行队列与资源授权。Pi 0.85.1 运行在 Electron utilityProcess，拥有会话 JSONL；凭据只由主进程提供。模型通过现有 Providers 设置连接，不再将“保存任务”呈现为 AI 执行成功。

Hermes 0.9.8 拥有 SQLite 与 Markdown 记忆。`patches/pi-hermes-memory@0.9.8.patch` 补充桌面宿主接口、GUI 修改同步、无项目上下文、学习来源/提交策略和包内运行边界，保留上游工具、复盘、纠正与压缩前学习实现。桌面运行不调用用户 PATH 中的 `pi -p`，也不扫描全局 Pi 扩展、技能或项目记忆。

复用 Mustache 负责一次性纯文本变量解析，TypeBox 负责 IPC 与持久化边界校验，CodeMirror 负责编辑和补全，react-markdown / remark-gfm 负责结果渲染，selection-hook 负责原生选区读取。快捷键继续复用已有 react-hotkeys-hook 录制逻辑。版本与研究依据见 [实施计划](plans/2026-09-10-general-agent-requirements.md#技术方案与复用决策)。

附件支持明确列出的 UTF-8 文本类型，单文件上限 1 MB；输入、展开指令、参数及附件合计上限 120,000 字符。任务保存只读副本与内容指纹；打开、附加或重新关联产物时检查真实文件。删除任务清理该任务拥有的数据，外部原件与长期记忆独立保留。

## 验证与使用边界

- `pnpm lint`、`pnpm typecheck`、13 个现有单元测试、1 个现有 Electron smoke 检查通过；生产构建及 macOS arm64 目录包构建通过。
- 使用隔离目录和本地 OpenAI-compatible 响应夹具，验证真实 Pi 流式调用、输入确认、原生文件/终端工具、队列取消、停止、幂等提交、历史版本复跑、四类参数、记忆管理与重启持久化。同一流程已在目录包中运行。夹具只替代模型网络响应，不替代 Pi、工具执行或存储。
- 包内 Hermes 默认 10 轮自动复盘已通过：后台请求使用同一连接，命令首轮与模板不进入复盘输入，学习结果自动刷新设置页，暂停再恢复会丢弃暂停前尚未提交的写入。
- 远端模型需要在 Settings → Providers 配置。未使用用户远端模型凭据发送验证请求。selection-hook 原生模块加载和系统辅助功能权限状态检查通过；尚未验证跨应用选区快捷键的完整路径，原位替换不在本版范围。
- 本地目录包位于 `apps/desktop/release/mac-arm64/AI.app`，未签名或公证，未发布。构建仍提示 renderer 分块体积偏大与默认应用图标。

## 验证隔离修正

首次目录包验证发现已有启动逻辑只在开发构建处理 `AI_TEST_USER_DATA`，导致该次检查误用默认应用目录。已修正启动条件，现有 smoke 和本次验证脚本都先断言 `app.getPath('userData')` 等于指定目录，再操作应用。修正后的目录包与自动学习流程已重新在独立目录核验。

默认目录中的 Agent v1 数据目录创建于该次检查，全部 17 条任务属于验证夹具，已移到 `.artifacts/default-profile-verification-recovery/`；测试 Provider 已清除，快捷键、置顶和旧版浏览器存储保留。没有验证前的 Provider 快照；若此前配置过连接，需要重新填写。恢复备份包含运行数据，保持本地忽略，不进入提交。

## 历史资产

`design-assets.json`、`third-party/Hugeicons-LICENSE` 与早期五个 SVG 保留为 2026-09-09 初始面板资产记录；当前产品使用 Lucide，这些旧资源不代表 Agent v1 图标或布局基线。Inter 由 `@fontsource-variable/inter` 本地提供。

## 2026-09-12 应用同步：多连接、响应式设置与指令生成

代码按最新[提供商修订计划](plans/2026-09-12-provider-defaults-design.md#应用实现记录--2026-09-12)及产品页 `1:251` / 组件页 `69:80` 实现。Figma 保持原画板、共享库实例、变量和原型；本轮更新相关组件 usage description 的实现状态，纠正旧单连接说明与已被新计划取代的 Compact 24px 顶部 inset。

| Figma owner                                                 | 应用 owner                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings window layout · Responsive `1119:36110`            | `settings-window.tsx` / `settings.css` / `electron/settings-window.ts`                                                                                                  |
| Settings overview header · Rhea `1181:38808`                | `settings-heading.tsx`，Providers / Commands / Memory 共用                                                                                                              |
| Settings editor layout / footer `1093:34262` / `1093:34242` | 共享滚动正文与页脚样式、命令/参数/记忆/连接表单                                                                                                                         |
| Command identity `1093:34209` / Run settings `1062:33204`   | `command-editor.tsx` / `run-settings.tsx` / `commands.css`，220px 字段与16/8px间距                                                                                      |
| Provider connections `913:17261` / Model picker `954:19478` | `provider-settings.tsx` / `model-picker.tsx` / `providers.css`，连接内4px与跨连接8px边界                                                                                |
| Command instruction generator `1231:39739`                  | 已由 Agent 会话的 `command` 工具与编辑器移交入口取代（见 2026-09-17 命令 AI 编辑）；原 `instruction-generator.tsx` / `instruction-generation.ts` 已删除，Figma 侧待同步 |

代码仍复用项目 Rhea primitives、Radix/cmdk/CodeMirror 和仓库中原始品牌 SVG。该阶段先完成静态检查；其后的完整 UI 走查见下节。真实账户 OAuth 与计费模型调用不在本次视觉验收范围。

## 2026-09-12 完整 UI 走查与透明弹层修复

用户补充的共同验收条件是：可滚动内容统一使用 ScrollArea；项目项、卡片、页面和普通对话框的标题、描述优先单行省略，保留完整值的 title 或详情入口。输入正文、会话内容、校验错误与确认操作所需的正文保持可读。

- 命令 More 菜单统一为 224px、三项次要动作、16px Lucide 图标与 9px 分隔区域，避免 Edit / Delete 文案挤成两行。Run、Switch、More 保留固定顺序；窄列表将身份和动作分为两轨，空快捷键或长名称不改变动作列。对应 Figma 主组件 `487:11060` 和实际 Enabled / Disabled 菜单均保留原型连接。
- 所有可见滚动区域复用已安装 Radix 的 [Rhea ScrollArea](https://ui.shadcn.com/r/styles/radix-rhea/scroll-area.json)，包括设置、表单、抽屉、菜单、Select、变量补全、对话框、会话、代码/表格、工具详情、附件与长输入。默认纵向 viewport 使用可收缩的 flex 布局，避免仅有 max-height 时内容被裁掉却不能滚动；横向区域保留独立测量。滚动条不占内容布局宽度。
- CodeMirror 继续拥有匹配、选择、键盘与插入。通过其公开 completion state 和 tooltip API 将可见列表呈现为 ScrollArea；默认 tooltip 仅保留不可见的库内分页度量，避免 PageUp / PageDown 失效。没有自写匹配器或劫持原生列表 DOM。补全已关闭自动补括号，避免插入后多出 `}}`。
- Select 复用 Radix popper 定位、8px 视口避让和 ScrollArea viewport，修复短窗口中的选项越界。设置抽屉修复 Tailwind 独立 translate 残留，打开时聚焦当前目的地，Escape 或导航后关闭并恢复触发器焦点；Tooltip 保留键盘与悬停触发，避免鼠标关闭后自动弹出。确认框保留 16px 视口边距，标题避开关闭按钮，长正文滚动而底部动作保持可达。
- 提供商品牌图标使用正确引用的仓库 SVG；修复长连接名、长认证选项、目录失败提示被隐藏和表单内边距覆盖。面板修复长命令、工具详情、附件、Composer 与输入错误挤占底部操作的问题。

Figma 继续复用项目组件与远端共享库连接。Provider row `910:17467` 增加 Inline / Stacked 共 18 个状态，按内容宽度 475px 切换，有效内边距包含代码 1px Item border。命令行 `373:1416` 保持同一 Run / Switch / More 结构；参数行 `414:1817` 统一四项图标操作；项目按钮 `907:17188` 的 24 个变体将图标与标签绑定为同一语义色。命令运行页共用 footer `1287:45290`。Panel dialog `1289:45187` 与权限 overlay `1292:46322` 表达正文滚动和固定操作，普通对话框描述保持单行省略；预览使用 Content / Bounded 高度变体，短内容自然收缩。权限入口分别映射新任务、命令定义或历史快照的初始值，产品页原型指向同页连接实例。Figma 需要显式选择结构性变体；源组件 usage 记录断点和代码映射，实际消费者保留文案、状态与原型目标。

透明材质仍采用原来的窗口/菜单 80% tint、设置内容/抽屉 10% tint、菜单 20px 与抽屉 40px 模糊。实测 Electron 44 的透明 backing surface 会把 CSS backdrop blur 再叠到清晰原像素上；调整窗口透明开关、普通 filter/isolation 或动画没有解决。实现复用原生 [SVG feGaussianBlur](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feGaussianBlur) 与 [feComposite](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feComposite)，仅在上层浮层覆盖的区域替换下层 portal 的像素，保留 alpha；原生窗口继续拥有桌面毛玻璃、外轮廓与阴影。全窗表面保留 alpha 下限，防止 SVG 模糊在窗口边缘产生亮晕；局部弹层保留透明圆角，并扩展滤镜范围以容纳模糊与外阴影，避免多层覆盖时变成方角。读取 alpha 兼容 CSSOM 的 rgba 与 oklab 等现代颜色表达。该适配限于 macOS Electron，Radix / CodeMirror 仍负责定位、焦点、关闭和滚动；关闭浮层后清除临时滤镜。

本次使用独立 Electron 数据目录分批检查：设置 320 / 480 / 760 / 1000 / 1280px 及 479 / 759px 断点边界和短高，共 36 个页面与尺寸组合，没有水平越界或页面异常；面板覆盖 320 / 420 / 640px，含 320px 短高与长文本。变量补全的键盘翻页、选择、插入，长认证选项、错误反馈、抽屉焦点和关闭均实测。原生合成截图核对明暗背景中的四角、边缘、阴影及材质。

检查记录与截图位于 `apps/desktop/.artifacts/ui-audit/`、`ui-audit-command/` 及各批次目录；生产设置矩阵为 `final-settings-matrix.json`，原生明暗证据为 `os-composite-*-final.png`。`pnpm check` 的格式、Oxlint、TypeScript、13 个现有单元测试、生产构建均通过，`pnpm test:electron` 的现有冒烟检查通过。真实账户认证与远端模型请求没有执行。

### 首页长标题溢出反馈

后续截图显示首页长命令名越过右侧边界。代码补齐 `CommandLauncher` 的行与文字容器约束：行允许收缩，文字容器裁剪自身内容，标题和描述由同一处 CSS 明确设为块级、单行省略，快捷键组不参与收缩。保留完整字符串的 `title`。Figma `App / Command item`（`337:1155`）原本已有 Fill + clipsContent + ENDING/maxLines1，本次补充 usage 映射并读回实际实例，未改变既有几何或原型。

截图中的原状态未在新开的窗口复现，未将缓存或热更新判定为根因。修改后使用独立 Electron 数据目录检查开发版和生产版，覆盖 320 / 420 / 640px 宽、580 / 320px 高的 12 组首页布局，以及 2 组命令目录；包含长英文、无空格标题、中文长描述、有/无快捷键和悬停/键盘焦点。文字与快捷键均在行内，标题和描述各占一行，页面错误为零。截图和尺寸读数位于 `apps/desktop/.artifacts/title-overflow/`。本次 `pnpm check` 的格式、lint、类型、13 个既有单元测试与构建通过。

### 首页文字列与抽屉动效反馈

用户继续用红框指出：无快捷键的第二条命令文字伸入第一条的快捷键列。此前只验证文字在窗口内且单行省略，没有满足同行内容边界一致的要求。现在 `CommandLauncher` 的快捷命令组通过 CSS Grid / subgrid 统一图标、文字和快捷键三列；快捷键列由整组实际内容的最大宽度决定，空快捷键行保留这一列，整组没有快捷键时才使用两列。标题和描述继续单行省略，并通过 `title` 提供完整值；没有添加占位按钮或不可见快捷键。

设置抽屉改用共享 [Rhea Sheet](https://ui.shadcn.com/r/styles/radix-rhea/sheet.json)，复用已安装的 Radix Dialog 焦点与关闭行为。设置组合指定从左侧完整滑入／滑出，时长 200ms，缓动 `cubic-bezier(0.4,0,0.2,1)`，保持内容 opacity 为 1，不使用居中缩放；减少动态效果时取消动画。局部关闭通用 CSS transition，避免原生模糊适配切换 `backdrop-filter` 时产生额外过渡。现有透明适配增加 Sheet 表面选择器，抽屉继续使用 10% 表面与 40px 模糊，原生窗口控件和桌面材质归属不变。

Figma 在既有 [App / Command item](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=337-1155) 增加 `Presentation=Quick`，保留 Catalog 及其消费者。首页两处实际实例与组件页两处实例统一迁入 Quick，并复用远程 Kbd 及既有 Rhea 适配。父级 `App · Home command grid` 模式统一控制快捷键列宽与可见性：Three keys／No shortcuts／Five keys 分别为实测的 69／0／118px。Figma 无法自动实现 CSS subgrid 的跨行测量，因此这些是明确的内容模式；换快捷键组合时须按实际最大宽度调整模式，不能把某个宽度当作通用常量。已验证 320／420px 长文字混排、640px 五键与 320px 全无快捷键，随后恢复原始文案、尺寸和原型。

[Settings window layout · Responsive](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1119-36110) 的开闭变体使用同名抽屉层，在 -264px 与 0 之间 Smart Animate，窗口栏和正文保持不动。17 个实际消费者的层名、两处导航 Tab 与继承点击已同步；每个实例往返切换后均保留正文、SLOT、选中章节和原型目标，并恢复原来的 15 个关闭态、2 个打开态。菜单、关闭、遮罩和 Escape 均读回同一 200ms 自定义贝塞尔，按钮 hover 不变。Figma 验收记录分别为 `ui-audit-command/home-copy-boundary.md` 与 `ui-audit/settings/drawer-figma-audit.json`。

隔离 Electron 验证覆盖开发／生产两种加载方式：18 组首页布局包含 320／420／640px、不同长度快捷键与全无快捷键，另检查 320px 短高时 ScrollArea 内入口可达。8 组抽屉检查覆盖 320×400、420×685、479×320、导航后关闭、480／760px 断点切换、关闭按钮／Escape／遮罩、焦点限制与归还、减少动态效果及关闭后滤镜清理。逐帧记录确认只发生横向平移；原生录像及明暗背景截图核对侧滑、透明材质和窗口边缘，页面错误为零。

本轮证据位于 `apps/desktop/.artifacts/drawer-motion/`，其中 `home-shared-columns-production-420.png` 替代此前被用户指出问题的首页截图，`drawer-slide.mp4` 为真实窗口开闭录像。最终 `pnpm check`（格式、Oxlint、TypeScript、13 个现有单元测试、生产构建）与现有 Electron 冒烟测试通过；临时运行时与隔离数据目录已清理。

## 2026-09-13 菜单式弹层自适应宽度

用户要求所有 dropdown 形态的弹层随内容调整宽度，并保留最小宽度。代码使用原生 [`max-content`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/max-content) 计算内容宽度；Radix 弹层沿用[可用空间约束](https://www.radix-ui.com/primitives/docs/components/dropdown-menu#constrain-the-contentsub-content-size)与碰撞处理。最小宽度受可用窗口宽度约束，不能在窄窗口中撑出页面。

| 弹层                   | 最小宽度               | 宽度上限与代码归属                                                                 |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| 操作菜单、子菜单       | 128px                  | Radix 可用宽度；共享 `dropdown-menu.tsx`                                           |
| Select 选项            | max(144px, 触发器宽度) | 窗口宽度减 16px 上限；共享 `select.tsx`，popper 下跟随触发器，内容更长时按内容扩展 |
| 通用 Popover           | 288px                  | Radix 可用宽度；共享 `popover.tsx`，业务组合可定义自己的最小值                     |
| 连接内及跨连接模型菜单 | 256px                  | Radix 可用宽度；`providers.css` 的 `model-picker`                                  |
| 变量选择器             | 320px                  | 460px 与 Radix 可用宽度的较小值；`commands.css` 的 `variable-picker`               |
| 指令变量补全           | 320px                  | 原有 460px／窗口减 32px 上限；`instruction-theme.ts` 已采用内容宽度，继续沿用      |

移除命令菜单的 224px 和连接菜单的 240px 固定宽度；图标、快捷键及禁用原因参与内容宽度计算。继续复用现有 ScrollArea、键盘操作、模型菜单 18px／14px 圆角与单层 4px 边界。

本轮定向格式、Oxlint、TypeScript 与独立输出目录中的 renderer 构建通过；构建保留分块体积提示。未启动或连接应用运行时，因此尚未验证实际窗口中的内容宽度、窄屏碰撞和滚动效果。

Figma 对应组件已记录新宽度规则，但自适应结构尚未同步。临时连接实例试验显示：仅设 Hug 会保留旧宽度，逐层解除 Fill 后会使选项高亮失去整行宽度；恢复高亮 Fill 又使外层收缩到最小值。嵌套实例的 max-size 覆盖被 API 拒绝，原生 Grid 试验也未同时满足两者。试验节点均已移除，保留原组件、共享库引用与画板几何；不把现有固定评审宽度当作自适应布局的验收证据。

## 2026-09-17 Select 弹层内边距同步

用户截图指出 `features/commands/parameter-field.tsx` 的语言选项弹层没有内边距。根因在共享组件而非该字段：4px 边界原先只挂在 `SelectGroup` 上，而应用内 8 个文件的 10 处 `SelectContent` 都直接渲染 `SelectItem`、从未使用分组，弹层因此实际为零内边距。此前「应用 Select 已按各自 primitive 布局」的判断只核对了连接与宽度，没有测量累计内边距。

现在由 `packages/ui/src/components/select.tsx` 的 `SelectContent` 拥有单层 4px inset，与 `DropdownMenuContent`、`Command`、`model-picker` 的单层 4px 口径一致；`SelectGroup` 不再叠加，分组用法仍保持单层。行文字与勾选指示距材质边 12px，选中／悬停高亮距材质边 4px，`parameter-field.tsx` 及各消费者无需改动。

同轮用户要求下拉列表与触发器等宽。`SelectContent` 的最小宽度改为 `min(max(144px, var(--radix-select-trigger-width, 0px)), 100vw - 16px)`：popper 定位取触发器宽度与 144px 中的较大值，长选项仍按内容扩展，窄窗口继续受视口上限约束。这取代 [菜单式弹层自适应宽度](#2026-09-13-菜单式弹层自适应宽度) 中「取消与触发器宽度绑定」的单一 144px 下限，`SelectGroup` 与所有消费者自动继承。

触发器宽度让原先照菜单尺寸调好的开合动画变得明显：`zoom-in-95`／`zoom-out-95` 以 `50% 0` 为原点缩放，长宽弹层在 100ms 内左右各移动约 20px，看起来像被横向拉伸。按用户决定，Select 弹层不再有动画：官方 [base select](https://ui.shadcn.com/docs/components/base/select) 的默认 `alignItemWithTrigger` 会命中 `data-[align-trigger=true]:animate-none`，文档页看到的弹层是直接出现；应用把定位改成 popper 后动画才生效。因此从 `SelectContent` 移除 `animate-in`／`animate-out`、`duration-100`、按方向的 `slide-in-from-*` 与 `data-[align-trigger=true]:animate-none`，触发器自身的焦点色／阴影过渡保留。DropdownMenu、Popover、Tooltip 的动画不变，它们宽度仍由内容决定。

定向 Oxlint、oxfmt、`@ai/ui` 类型检查与 `@ai/desktop` 的 renderer 生产构建通过，构建产物已生成对应的 `min-width` 规则；未启动应用运行时，本环境也没有 Figma 工具，因此未复核实际窗口与画板几何。设计记录中 [弹层内边距深度排查](#弹层内边距深度排查仅-figma) 的 4px 口径已由代码兑现。

## 2026-09-17 命令输入页进入即报错修复与辅助功能权限申请

用户截图显示从首页点击 `Translate selection` 进入命令输入页后立即出现 "No selected text was captured."，且没有捕获内容却显示 "Captured 10:16:11"；随后确认正确行为：需要走系统的权限申请。应用从未在打开命令时提交任务：首页快捷命令、命令目录和设置列表的入口都只调用 `prepare` 并停在输入页，真正运行仍需要用户按 Run。

根因在 `CommandService.prepare` 与 `emptyInput()`：准备流程对命令声明的选区／剪贴板来源总是尝试捕获，任何失败都写入 `notice`，输入页进入时把 `notice` 弹成错误；空输入又用当前时间填充 `capturedAt`。现在只有全局快捷键触发把捕获失败作为 `notice`（`register` 传入 `expectCapture`，与 C3「快捷键在浮窗获取焦点前捕获、读取失败明确展示」一致）；`emptyInput().capturedAt` 改为空字符串，只有真实捕获才显示 "Captured" 时间。

按用户确认的正确行为，读取选中文字前走系统权限申请：`selection-hook` 的 `docs/GUIDE.md` 在 Node 场景使用其 `macRequestProcessTrust()`，在 Electron 场景推荐 `systemPreferences.isTrustedAccessibilityClient()`，因此由主进程的 `CommandService.requestAccessibility()` 在 macOS 未授权时调用 `isTrustedAccessibilityClient(true)` 触发系统授权对话框，每次启动最多一次，避免重复打扰。触发点是打开声明了选区来源的命令（`prepare`）与 `captureSelection()`（命令快捷键、浮窗唤起）；权限检查、申请与提示都与捕获同属主进程服务，`selection-hook` 继续只负责捕获。

用户随后用箭头指出提示只显示前半句：`lib/errors.ts` 的 `toastTextOf` 只保留首个句号前的句子并限制在 80 字符内，原消息的第二句（系统设置路径）被截掉。两条捕获失败消息因此改为单句且不超过该上限：「Enable Accessibility: System Settings → Privacy & Security → Accessibility.」（未授权）与「No selected text — select text in another app, then use the command shortcut.」（已授权但没有选区）；不再使用原先「Accessibility permission may be required」的模糊说法，后续修改提示文案时需保持单句可完整显示。

打开缺少选区／剪贴板的草稿仍保持静默：字段留空等待手动输入或显式点击捕获按钮，不会因为进入页面就报错。定向 oxfmt、Oxlint、`pnpm typecheck` 与 13 个现有单元测试通过；未启动应用运行时，无法在真实 macOS 授权对话框下复核申请时机与授权后的捕获，本环境也没有 Figma 工具，Figma 侧的权限引导样例待有工具时复核。

## 2026-09-17 界面语言选择器与 i18n 基础

用户要求在设置窗口右上角（截图红框）添加语言选择器，并把 i18n 作为后续由 agent 增量翻译的基础设施写入 [AGENTS.md](AGENTS.md#internationalization)。渲染层复用社区方案 i18next 26.4.2 + react-i18next 17.0.14（模块级同步初始化、无需 Provider、键类型直接来自英文 JSON），没有自建翻译层；当前语言集为 `en`（源语言）与 `zh-CN`。

| 归属                                                                                       | 实现                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/i18n/`                                                                   | 初始化、`settings` 命名空间资源、`useAppLanguage`、语言自称（endonym）与首次启动的初始语言解析                                  |
| `electron/settings-contract.ts`                                                            | `LANGUAGE_CODES` / `AppLanguage` / `isAppLanguage` / `resolveLanguage`；`SettingsSnapshot.language` 与 `setLanguage` 契约       |
| `electron/settings-store.ts` / `settings-service.ts` / `preload.ts`                        | `language` 持久化；`settings:save-language` IPC 仅接受设置窗口，主进程校验、写盘并广播                                          |
| `features/settings/settings-window.tsx` / `settings.css` / `language-selector.tsx`         | 内容表面顶部 40px 头部行内的右对齐 Select（Rhea 默认触发器 32px、`Languages` 图标、语言自称）；切换后两个窗口即时生效，无需重载 |
| `features/settings/provider-settings.tsx` 与设置外壳（导航、抽屉、移动栏、加载、预览提示） | 本轮迁移的文案，en 与 zh-CN 键集合一致                                                                                          |

选择器位置按 Figma 读回的口径实现：`App / Settings window layout · Responsive`（1119:36110）内容表面 inset 12px、padding 40/40/32、概览标题自表面顶部 40px 开始，右上角是未被占用的表面内边距；代码新增的 40px 头部行替代原 `padding-top`，桌面标题仍从 40px 开始，32px 控件位于表面 y 4–36，右端对齐内容 inset 40px（窗口右缘内 52px）。紧凑布局（≤759px）标题偏移由 16px 变为 40px，因为 32px 控件无法放进 16px 的旧边距。

Figma 侧未同步：本环境只有只读的本地 Figma MCP（`figma-desktop_*` 工具集没有写入能力），无法新增选择器实例或变体。待有写权限时应在 `App / Settings overview header · Rhea`（1181:38808）或窗口组件层补齐，并复核 Desktop／Compact／Drawer 与二级页头部（`1045:32910`、`1093:34262`）；当前不把代码侧实现当作 Figma 已同步。

本轮是增量迁移的第一步：快捷键、命令、记忆、提供商子页与任务面板仍保留英文文案，后续按 AGENTS.md 的增量约定在改动时迁移；主进程原生菜单、对话框与窗口标题仍为英文。验证为定向 oxfmt／Oxlint、`pnpm --filter @ai/desktop typecheck` 与 13 个既有单元测试通过（英文值保持不变），未启动应用运行时，因此选择器的实际窗口位置、跨窗口切换与原生合成外观尚未复核。

## 2026-09-17 全界面 i18n 补齐

用户截图指出上一轮只迁移设置外壳与 Providers 总览后仍有多处英文（提供商行操作菜单、任务面板标题栏、任务权限弹窗）。本轮按功能域拆分为 `providers`／`commands`／`memory`／`panel`／`tasks` 五个命名空间，外加 `common` 承载共享词条，把渲染层其余用户可见文案全部迁入 i18n。各命名空间 en 与 zh-CN 键集合一致，共 536 条：common 10、settings 70、providers 95、commands 159、memory 36、panel 74、tasks 92。

| 归属                                                         | 迁移内容                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `features/providers/**`                                      | 连接行状态与操作菜单（当前默认／管理连接／刷新模型／断开连接）、目录、表单、登录、模型选择器、自定义模型 |
| `features/commands/**`                                       | 命令管理、编辑器、参数与变量、运行设置、指令生成、预览、快捷键输入                                       |
| `features/memory/**` 与设置剩余                              | 记忆列表／编辑／暂停／确认；快捷键设置、二级页返回、设置加载错误                                         |
| `panel`（`App.tsx`、`components/**`、`features/agent` 外壳） | 面板标题栏、欢迎区、Composer、语音输入、命令启动器与命令输入页                                           |
| `tasks`（会话、历史、文件、请求、权限）                      | 会话操作与复制反馈、任务历史、文件操作、输入请求、任务权限弹窗                                           |

共享工具词条（Read files／Create files／Edit files／Terminal）不再使用主进程 `TOOL_DESCRIPTIONS` 的英文标签，改由 `common.tools.*` 提供，任务权限弹窗与命令运行设置共用；权限弹窗的“新增能力”现在显示本地化标签而不是 `read, write` 原始 id，复核弹窗中的运行状态也改用 `tasks.status.*` 标签。`common` 同时承载全局 toast 的关闭控件。

独立复核后按中文质量清单统一了术语：对话（不再混用“会话”）、每次询问、设置分类、命令（不再把 Commands 写成指令）、创建副本，并修正若干措辞。英文值保持原样，13 个既有单元测试继续通过。

保留的英文边界：主进程原生菜单／对话框／窗口标题、提供商目录元数据（认证方式与云字段标签）、主进程校验消息（[command-validation.ts](apps/desktop/electron/agent/command-validation.ts)）、[errors.ts](apps/desktop/src/lib/errors.ts) 的回退文案，以及 Agent 运行数据（消息、工具输出、任务标题、模型 id）。处理它们需要主进程侧的语言方案；本轮未修改 `electron/**`（另有任务在改）。

验证：oxfmt／Oxlint、`pnpm --filter @ai/desktop typecheck`、13 个既有单元测试与 renderer 构建通过；行为完整性与中文质量两项独立复核通过，复核发现的 P2 项已修复。未启动应用运行时，未做实际窗口、跨窗口切换与原生合成检查。

## 2026-09-17 命令 AI 编辑移交 Agent 会话

用户决定：命令的 AI 生成不再在编辑器内弹出建议对话框，而是由主面板的 Agent harness 直接创建和修改命令；编辑器里的 AI 入口改为打开一个新会话去改。原来的「只能写指令」与随后的「整份命令建议」两条路径因此都被取代，避免同一能力有两个所有者。

运行时流程：

- 主面板普通任务的默认工具集加入 `command`（[run-service.ts](apps/desktop/electron/agent/run-service.ts)），Agent 可以列出、读取、创建和更新命令。读取不需要确认；写入沿用现有权限弹窗逐次确认，确认卡列出创建的全部字段，更新只列出变化的字段，被拒绝时不落库。
- 写入与设置编辑器共用同一套校验（`validateCommand` + `CommandSchema`）与 `CommandService.save`：只有 name、description、instructions、input、parameters、tools、memory 七个字段可由 Agent 写入，id、revision、enabled、shortcut、templateId 与 model 仍归用户；更新必须带上读取到的 revision，过期会要求重新读取后再改。
- 命令保存或删除成功后由 `CommandService` 广播一次快照，面板与设置窗口的命令列表随之刷新（此前由两个 IPC 处理器各自广播）。
- 编辑器页脚左侧的 AI 按钮调用 `settings:start-command-session`：主进程校验来源、解析 id 并取名字，先向面板发送 `agent:command-session` 再显示面板；面板据此开启新会话，把「更新命令 “X”（id：…）：」或「创建命令：」作为种子文本放进输入框，由用户补充意图后发送。该按钮此前短暂放在二级页标题行的 actions 槽，按用户反馈移回页脚左侧；`SettingsHeading` 的 `actions` 因此在失去唯一消费者后被移除，共享头部组件恢复原形。
- 运行设置按用户反馈从页脚弹层改为编辑器正文里的正式表单项（`run-settings.tsx`，位于参数之后）：模型策略（含固定模型选择器）、记忆、允许的工具。原 `.run-settings-popover` 与 `run.modelPolicy`／`run.memoryPolicy` 随之删除，Select 改用可见标签关联（`htmlFor`／`id`）而不是 `aria-label`。工具列表按预设列表形态重排为 `ItemGroup` + `Item variant="outline" size="sm"`（`ItemContent` 标题／描述 + `ItemActions` 开关，描述改用预设的 14px muted）。整块布局由 grid 承担：`.run-settings` 提供 16px 分区行距，工具网格 `.run-settings-tools` 采用与 `.field-columns` 相同的 220px 最小列宽与 16px 间距，但上限为三列（`repeat(auto-fit, minmax(max(220px, (100% - 32px) / 3), 1fr))`）：宽窗口始终三列，456–691px 两列，更窄与并排字段同步收成一列，每张卡片内部再由 `.run-settings-tool[data-slot='item']` 的 `minmax(0, 1fr) auto` 把开关固定到独立轨道；并排的模型／记忆继续使用既有的 grid + subgrid 轨道（`.field-columns.aligned-fields`）。Figma `1062:33204` 仍保留展开／收起变体，需要设计侧改为常驻分区。

实现归属：

- `electron/agent/command-schema.ts`：`command` 工具 id、`CommandFieldsSchema`、`CommandToolSchema` 与工具回复 schema；`TOOL_DESCRIPTIONS` 增加条目，显示文案由 `common.tools.command.*` 提供。
- `electron/agent/command-tool.ts`（新增）：list／get／save，revision 守卫、字段合并与确认卡文本。
- `electron/agent/native-schema.ts`、`native-tools.ts`、`task-runtime.ts`、`service.ts`：`commandList`／`commandGet`／`commandSave` 三个 native action，按运行快照的工具集授权，工具实例在 `AgentService` 中构造一次。
- `electron/agent/worker-session.ts`：注册 `command` 工具，允许列表沿用运行快照的工具集。
- `electron/main.ts`、`settings-contract.ts`、两个 preload：设置窗口到面板的移交通道与本机来源校验。
- `features/commands/command-editor.tsx`、`features/agent/use-task-panel.ts`：编辑器移交按钮与新会话种子。

同时移除（同一决定的一部分）：编辑器内建议对话框 `command-generator.tsx`、`generation-review.tsx`、`command-changes.ts`，以及主进程的 `command-generation.ts`、`command-generation-prompt.ts`、`generation-contract.ts`、`settings.generation` 桥和配套 i18n／CSS。手动编辑、保存、运行设置、参数编辑与命令运行入口保持不变。

验证：oxfmt／Oxlint、`pnpm typecheck` 与既有 20 个单元测试通过（`--force` 强制不使用缓存）；独立复核确认按工具集授权、确认先于写入、失败与拒绝不广播、可写字段范围与校验和编辑器一致、删除后无残留引用。未启动应用运行时，因此 Agent 实际调用工具、确认卡渲染、移交后的窗口聚焦与原生合成外观尚未复核。

未同步范围：Figma 仍保留「生成指令」旧对话框（`1231:39739`）、运行设置的展开／收起变体（`1062:33204`），也还没有页脚左侧的 AI 入口；本地 Figma MCP 只提供只读工具（`get_design_context`、`get_variable_defs`、`get_screenshot`、`get_motion_context`、`get_metadata`、`get_figjam`），没有写入能力，云端 Figma 工具在本会话不可用，因此本次没有修改设计文件。

## 2026-09-17 面板改用 macOS 原生窗口控件

用户要求移除主面板 header 右侧的关闭按钮，改用 macOS 原生窗口管理按钮。实现归属：

| 归属                                          | 实现                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/main.ts`                            | 面板在 darwin 使用 `titleBarStyle: 'hidden'` 与 `trafficLightPosition: { x: 16, y: 18 }`（与设置窗口同一口径），其他平台保持 `frame: false`；darwin 的原生关闭按钮经 `close` 事件调用 `hidePanel()`，窗口只隐藏不销毁，全局快捷键与应用菜单仍能显示同一窗口，退出流程继续由 `quitting` 标记让行 |
| `App.tsx`、`features/agent/use-task-panel.ts` | header 关闭按钮只在非 darwin 渲染，`useTaskPanel` 暴露已有的 `platform` 解析；web 预览与 Windows/Linux 的隐藏入口及 `setHidden` 行为不变                                                                                                                                                        |
| `src/styles.css`                              | `html[data-platform='darwin'] .panel-header` 预留与设置窗口相同的 88px 原生控件区，logo 与标题不再与三灯重叠                                                                                                                                                                                    |

原生关闭按钮复用原 X 的「隐藏而非退出」语义；绿灯按用户要求保持可用（`maximizable: true`），与设置窗口同为 macOS zoom：缩放到工作区而不进入原生全屏（`fullscreenable: false`），因为面板是快捷键唤起的浮窗，全屏 Space 与「召回即重新停靠」的显隐模型冲突。`pnpm test:electron` 的既有冒烟检查改为直接关闭面板窗口，断言窗口隐藏但仍存在，再经 `activate` 恢复显示。

验证：定向 oxfmt／Oxlint、`pnpm typecheck`、`pnpm --filter @ai/desktop test`（20 个既有单元测试）通过。未启动应用运行时，因此三灯位置、header 内边距、原生关闭→隐藏的实际窗口表现与原生合成外观尚未复核；Windows/Linux 与 web 预览未做运行时验证。已知残留：退出流程执行 `runtime.close()` 期间若用户点击红灯，面板会销毁并触发 `window-all-closed`，应用可能不等清理完成即退出。

Figma 侧未同步：本会话没有可用的 Figma 工具（云端与本地均未连接），无法从 Panel header（`71:112`）移除关闭控件实例或为三灯预留左侧空间；待有写权限时同步该主组件、`App / Icon button` 消费者与响应式评审帧，当前不把代码侧实现当作 Figma 已同步。

## 2026-09-17 提供商表单默认模型改用共享 Select

用户截图指出连接详情表单的「默认模型」（`provider-form.tsx`）应接命令编辑器中「输入来源」同款的现有全宽 Select，而不是连接内模型搜索弹层 `ModelPicker`。该字段现在由共享 `Select` 渲染：触发器宽度与值截断继续由 `providers.css` 的 `.provider-form [data-slot='select-trigger']`／`[data-slot='select-value']` 拥有（与同表单的「认证」同一口径），选项为 `sortModels(available)`（已保存目录 + 自定义模型，按 id 排序）；未选择时用 `models.choose` 占位；当前值不在目录中时保留为 `models.unavailable` 选项，避免下拉框吞掉已保存的值。可访问名称沿用 `form.defaultModelLabel`（含连接名称），可见标签经 `htmlFor`／`id` 与触发器关联。随之删除只为该控件构造的 `preview` Connection。

保留范围：连接行（`provider-connections.tsx`）与 Composer／固定命令的 `ModelPicker` 连接内搜索菜单及跨连接选择不变，其菜单几何与最小宽度规则继续有效；表单字段本身不再提供模型搜索。

验证：定向 oxfmt／Oxlint、`pnpm lint`、`pnpm typecheck`、`pnpm --filter @ai/desktop test`（20 个既有单元测试）通过。未启动应用运行时，因此下拉位置与等宽表现、长目录滚动、禁用与窄窗口布局尚未复核。

Figma 侧未同步：本会话没有可用的 Figma 工具，无法读取或更新提供商详情表单中该字段的组件引用；待有写权限时把该字段同步为 Rhea Select，并把 `App / Provider selection menu` 留给连接行消费者。

## 2026-09-17 面板 header 图标尺寸统一

用户截图指出主面板 header 的 logo 按钮（`Astroid`，原先 20px）比右侧历史／设置按钮（16px）大，要求统一按钮图标尺寸。

实现归属：`App.tsx` 的 `<Astroid />` 去掉 `size-5`，改由共享 `Button` 的 `[&_svg:not([class*='size-'])]:size-4` 决定 16px，与同 header 内 `IconButton`（`icon-sm`，28px）的其他共享 Lucide 图标一致；`.panel-logo-button` 的 `margin-inline: -4px` 与标题位置保持不变，只更新了已过时的「20px logo」注释。AGENTS.md「shadcn Preset Fidelity」例外清单仍列有 logo sizing，本次未改动该文件。

验证：定向 oxfmt／Oxlint、`pnpm --filter @ai/desktop typecheck`、`pnpm --filter @ai/desktop test`（20 个既有单元测试）通过。未启动应用运行时，因此实际渲染尺寸、与标题的视觉间距及原生合成外观尚未复核。

Figma 侧未同步：本会话没有可用的 Figma 工具（云端与本地均未连接），无法把 [Panel header](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=71-112)（`71:112`）主组件内的 logo 实例从 20px 改为与共享 Lucide 图标一致的 16px；待有写权限时同步该主组件、`App / Icon button` 消费者与响应式评审帧。

## 2026-09-18 连续工具调用收进一个活动根节点

用户以 [Full conversation column](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=237-1370)（`237:1370`）为参照，要求连续的工具调用由一个根节点收集后展示。设计来源是该帧内的实例 `237:1418`，其主组件为 [App / Agent activity](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=204-1096)（`204:1096`，含 `201:425` Expanded 与 `204:1083` Collapsed 两个变体）。组件说明要求：只有真实工具调用进入 rail，助手正文留在 rail 之外；32px 行高、28px 层级缩进、1px 不透明连接线与 8px 弯折；隐藏末条分支时由 Tail=End 收尾。

实现归属：新增 `activity-groups.ts` 承担纯逻辑（`messageBlocks` 按相邻关系把同一轮助手消息切成文本块 / 工具块，文本永远切断根节点；`activityState` 聚合根状态，失败优先于运行中，运行中优先于中断；`isMemoryActivity` 识别全记忆调用）；新增 `activity.tsx` 渲染根节点（Collapsible + 根行 + 步骤列表）；新增 `activity-row.tsx` 作为根行与步骤行共用的行内容（20px 图标槽含 16px 图标、标题、右侧元数据、chevron，运行中用共享 `Shimmer`）；`tool-activity.tsx` 改为嵌套步骤行，保留自己的输入／输出折叠；`conversation.tsx` 改用 `messageBlocks` 渲染块；`agent.css` 拥有 stem、rail、lead-in 与末条步骤的 8px 弯折，`.tool-details` 的 rail 与根 rail 同色；`packages/ui/src/styles.css` 新增 `--activity-connector`（对应 Figma 变量 `activity/connector`），作为 rail 的唯一所有者；i18n 新增 `activity.ranTool` / `activity.ranTools`。

根节点的展开策略：运行或等待中保持展开，全部步骤进入终态后自动折叠一次；用户手动切换后以其选择为准。

标题与元数据的映射：运行时数据（`task-schema.ts` 的 `MessagePart`）只有 name／input／output／status，没有回合摘要，也没有逐步骤计时，因此根标题由调用数量生成（en `Ran 1 tool` / `Ran {{count}} tools`，zh `运行了 N 个工具`，全记忆调用沿用 `Memory`），右侧元数据是状态文案（Completed／Running…／Waiting…／Failed／Interrupted）。Figma 中的 `Done · 42s` 需要逐步骤耗时，本次未改动运行时契约与持久化数据。

验证：定向 `oxfmt`／`oxlint`、`pnpm typecheck`、`pnpm test`（20 个既有单元测试）通过；另用脚本核对分组与状态聚合（相邻工具合并为一个根、文本切分、单条与空消息、失败／运行／等待／中断的优先顺序、记忆判定）全部通过。未启动应用运行时，因此实际的 rail 连续性、折叠动画、窄面板下的换行与原生合成外观尚未复核。

对齐修正（用户反馈「线没对齐」）：在用户截图上按像素测量显示，共享 `Button` 的 `border border-transparent` 使 `.tool-heading` 的 padding box 相对边框盒偏移 1px，且每行实际高 34px。绝对定位的 heading stem 以 padding box 为包含块，于是根行 stem 落在根图标轴（相对 x8.5～9.5），而步骤 rail 落在 x7.5～8.5，两者错开 1px，且 stem 与 lead-in 之间还留下 1px 断口。现在 `.tool-heading` 设 `border-width: 0`（行高回到设计要求的 32px，图标回到轨道起点），`.tool-details` 的 rail 由 8px 改为 7.5px，接上步骤 heading 自身绘制的 stem。修正后用生产构建的 CSS（`pnpm --filter @ai/desktop build`）在无头浏览器渲染同构 DOM 并逐像素测量：四行行高均为 32px；根图标轴与 rail 同在相对 x8（同一列，无断口）；步骤内容起点 x28；步骤 heading 的 stem 与详情 rail 同在步骤图标轴；末条步骤的 8px 弯折收在相对 x16；弯折之后不再有 rail。该测量在无头 Chromium + 生产 CSS 上完成，Electron 窗口内的合成结果仍待用户在运行时确认。

Figma 侧未同步：本会话云端 Figma 工具不可用，本地 Figma MCP 只读，无法写入设计文件。本次设计侧不需要新组件（`App / Agent activity` 及两个 Disclosure 变体已存在），但两处实现差异未在设计文件中表达：根行右侧显示状态而非「状态 · 耗时」，以及上述默认折叠策略。另记一处待定项：新帧 `237:1370` 内各部分的间距是 8px，而代码沿用 `app.css`／`.assistant-message` 的 12px（与 [App / Conversation turn](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=693-4071)（`693:4071`）一致），本次未改动，待确认后再统一。

### 按设计稿重排：工具调用标签与结果卡片

用户反馈上一轮实现「没有按照设计稿来」。重新核对设计文件后确认：面向本应用的真实设计实例是 [Memory activity · Saved](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=772-4031)（`772:4031`，位于应用自己的会话轮次 `693:4071` 内），它给出了设计对真实数据的映射规则，而不是 237-1370 中标注为示意内容的文案：

- 根行 = 种类标签（`Memory`）+ 状态（`Completed`），32px 行、左 7.5px stem、4px lead-in、28px 缩进、末条 8px 弯折。
- 步骤行 = 动作标签（`Saved memory`）+ 目标（`User`，即 memory 写入工具的 `target` 参数），图标 68% 不透明度。
- 步骤内容 = 结果卡片 `Tool output`：`surface/raised` #262626、1px `border/subtle`、8px 圆角、16px 内边距、12px 间距；标题行 16px 图标 + 14/20 主色文本；正文 14/22 次级色；`Show full output` 展开原始输入与输出。

实现按同一规则映射到运行时数据：根标题在整段调用同属一种时用种类标签（复用 `common.tools.<id>.label`，memory 用 `activity.memory`，输入用 `activity.yourInput`），混合时用调用数量（`Ran N tools`），右侧固定显示状态；混合运行按种类聚合为 cluster（对应 237-1370 的同种类分组），meta 为「N 次」，单条调用直接作为 step；步骤标题用按工具的过去式动作标签（`activity.step.*`，含 memory 的四个动作），未知工具回退到原始工具名并保留 hover title；步骤右侧优先显示可由参数推导的目标（memory `target` → `activity.target.*`（User／Project／Memory／Failure）；文件工具 → 文件名；终端 → 命令首行；命令工具 → 命令名），推导不到时回退到状态文案；步骤内容改为结果卡片，标题行取输出的首个非空行（无输出时用状态），正文为后续预览，`显示完整输出` 展开原始输入／输出滚动区。图标按种类分配（read→FileText、write→FilePlus、edit→FilePen、bash→Terminal、command→SquareTerminal、memory→Brain、input→MessageCircleQuestionMark、未知→Wrench），运行中与失败仍分别用 spinner 与警示图标覆盖。新增 `--ata-surface-raised`、`--ata-radius-control` 两个 token（对应 Figma 的 `surface/raised` 与 `radius/control`），与既有 `--ata-border-subtle` 一起作为卡片的唯一所有者。

验证：`oxfmt`／`oxlint`／`pnpm typecheck`／`pnpm test`（20 个既有测试）通过；用生产构建的 CSS 在无头浏览器渲染同构 DOM，并按计算值与像素核对：六行行高均 32px；根图标轴与 rail 同在相对 x8；cluster 内容起点 x28、cluster 内步骤 x56；卡片计算样式为 rgb(38,38,38) / 8px / 16px / 1px / 12px 间距，与设计一致；步骤内容起点相对 x56。

仍未落地：设计稿中示意内容使用的散文式根标题（`Explored component patterns`）与分组的结果计数需要运行时并不存在的摘要与统计，本次分别以种类标签／调用数量与状态文案替代；逐步骤耗时仍未实现（transcript 不含计时数据），因此 `Done · 42s`、`2s` 一类时长未落地。Figma 侧仍只读，设计文件未改动。

## 2026-09-27 上下文窗口档位与自动压缩

计划：[`docs/plans/2026-09-27-context-window-and-compaction.md`](plans/2026-09-27-context-window-and-compaction.md)。代码与项目 Figma 文件已双侧同步，节点如下（链接格式 `https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=<id>`，`:` 换成 `-`）：

| Figma 节点                                                                                                                                                                                             | 代码                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| App / Model config content `1544:58725`：新增 `View=Root context tiers` `1557:58946`、`View=Context` `1557:58964`；App / Model config popover · Rhea `1544:58943`：同名变体 `1557:59043`、`1557:59133` | `model-config-popover.tsx`、`model-config-subviews.tsx`、`providers.css` |
| App / Model config option · Rhea `1557:58872`（Default / Hover / Focus；32px、6/8 内边距、14 圆角、16px 勾选槽）                                                                                       | `model-config-subviews.tsx` 的档位选项                                   |
| 15 · Context window & compaction `1557:59218`：App / Compaction activity `1557:59298`（Running / Completed / Completed expanded / Failed）                                                             | `transcript/compaction-block.tsx`、`agent.css`                           |
| App / Context usage ring `1557:59243`（Normal / Warning / Error × Default / Focus）                                                                                                                    | `compaction/context-usage-ring.tsx`、`composer.css`                      |
| App / New task hint `1558:58935`                                                                                                                                                                       | `compaction/new-task-hint.tsx`                                           |
| App / Progress pill segment `1523:57936` 新增 `Kind=Compacting` `1558:59086`；App / Progress pill `1499:53918` 新增 `Compacting` 轴 `1558:59091`                                                       | `progress/progress-pill.tsx`                                             |
| App / Composer `72:150` 新增 `Show context usage` 属性；App / Composer quick panel `1447:51964` 新增 `View=Context drill` `1558:60190`、`View=Compact query` `1558:60271`                              | `composer.tsx`、`quick-commands.ts`、`slash-drills.tsx`                  |
| 变量 `status/warning` `VariableID:1557:58847`（#f59e0b）                                                                                                                                               | `packages/ui/src/styles.css` 的 `--ata-status-warning`                   |
| 评审帧 `1558:60437`（420 与 320 宽）                                                                                                                                                                   | —                                                                        |

未同步或有差异：会话菜单项“整理上下文”（Figma 中没有会话菜单可扩展）；zh-CN 文案变体；运行中微光、旋转与圆环动画只写在组件说明里；14px 库图标的描边约 1.17px，代码为 1.75（约 1.02px）；摘要以 13/20 文本近似 Markdown；评审帧中的 Composer 仍使用待迁移的旧 `App / Composer selector`（见 `96:215`）。

## 2026-09-27 macOS 菜单栏状态项与程序坞显示

决策记录：`tmp/grill-me/outcome-claude-ce5ffe71-mac-menubar-20260927-221259.md`（本机，未提交）。仅 macOS；Windows 与 Linux 行为不变。代码与项目 Figma 已双侧同步：

| Figma 节点                                                                                                                                                                        | 代码                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 16 · Menu bar status item `1562:59907`：App / Menu bar status item `1562:59933`（State=Idle / Running / Attention / Unavailable，18 × 18 模板图，连接共享库 `Lucide / sparkles`） | `electron/menu-bar.ts`、`menu-bar-status.ts`；导出图在 `apps/desktop/resources/menu-bar/` |
| 预览帧 Preview / Menu bar appearance `1562:59934`（浅色与深色菜单栏）                                                                                                             | —                                                                                         |
| Settings / Shortcuts · Desktop preview `257:1454`：页脚 Window preferences `1561:48667` 新增 Show in Dock（默认关闭）                                                             | `shortcut-settings.tsx`、`use-shortcut-settings.ts`、`settings.css`                       |

- 入口：状态项是任务面板的第二入口。左键与全局快捷键共用切换逻辑：面板聚焦时隐藏，否则停靠到默认的右下角并显示、聚焦（按用户修正，不再锚定到图标下方）。失焦不自动收起。右键或 Control/Option 点击打开日常菜单项：显示/隐藏面板、设置、在浏览器中打开、退出；一次性的“迁移到 Agent Service”只保留在应用菜单中。
- 状态：服务断开或重连中（与面板横幅一致；启动时的连接中不算）> 等待输入或确认 > 排队、运行或停止中 > 空闲，只显示优先级最高的一种。tooltip 汇总数量，不显示数字标题；完成与失败不提示。主进程文案与应用菜单一样只有英文。
- 程序坞：`showInDock` 是本机偏好，默认关闭，不同步到服务，网页端不显示。打包版通过 `LSUIElement` 以代理应用启动，启动时不会闪现程序坞图标；开启后在运行时显示。开发版启动时会先出现图标，读取偏好后再隐藏。状态项始终显示，不能关闭。
- 恢复路径：图标被刘海或菜单栏管理工具遮住、全局快捷键又被占用时，从 Spotlight、Finder 或启动台再次打开 AI 会触发 `activate` 并显示面板。

验证：`pnpm test:electron` 覆盖默认隐藏程序坞、开关切换和四个模板图的 1x/2x 加载；打包版在隔离配置中确认默认启动期间程序坞始终不可见、保存为开启后重启会显示。打包版原生操作确认：点击状态项切换面板、右键菜单与“设置…”、深色菜单栏中的模板图着色、服务停止后的 Unavailable 图标与 tooltip、隐藏程序坞后设置窗口保持焦点、隐藏程序坞时输入框的 Cmd+Z / Shift+Cmd+Z / Cmd+A、重新打开应用恢复面板。未验证：Running 与 Attention 的真实任务状态（隔离配置没有模型提供商），以及 Cmd+C / Cmd+V（避免覆盖剪贴板）。

## 2026-09-28 登录时打开

设置「快捷键」页页脚的窗口偏好新增“登录时打开”（Open at login），默认关闭，顺序为：登录时打开、在程序坞中显示、始终置顶。代码与项目 Figma 已双侧同步：

| Figma 节点                                                                                                                                                                                                                                                                                      | 代码                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Settings / Shortcuts · Desktop preview `257:1454` 的页脚 Shortcut actions `1123:37578`：Window preferences `1561:48668`（上节记为 `1561:48667`，实际节点为 `1561:48668`）新增 Window preference / Open at login `1564:60015`，开关复用 App / Settings switch · Rhea `State=Unchecked` `284:983` | `shortcut-settings.tsx`、`use-shortcut-settings.ts`                                                 |
| Window preferences 改为 Fill、最小宽度 139（最宽一项的 Hug 宽度）、行距 12；Shortcut actions 改为左对齐、间距 16，偏好组占满剩余宽度，窄宽度下开关组内换行、恢复默认按钮随后换行                                                                                                                | `settings.css` 的 `.settings-window-preferences`（`gap: 12px 16px`）与 `.settings-shortcuts-footer` |

- 状态来源：系统登录项本身，不写入设置文件。主进程 `electron/login-item.ts` 读取 `app.getLoginItemSettings()`、写入 `app.setLoginItemSettings({ openAtLogin })`；设置窗口重新获得焦点时再读一次，在“系统设置”里做的更改会随之反映。
- 可用范围：仅打包版的 macOS 与 Windows。开发版（会注册裸 Electron 程序）、Linux 和网页端的快照值为 `null`，开关不显示。
- 三个开关只由左侧可见标签命名，不再显示重复标签的 tooltip（按用户修正；此前“始终置顶”的 tooltip 一并移除）。Figma 中这些行本就没有 tooltip，App / Settings switch · Rhea `284:988` 的用法说明已改为覆盖三个窗口偏好并注明不加 tooltip。
- macOS 13+ 若返回 `requires-approval`，开关保持关闭并打开“系统设置 › 登录项”，提示 `shortcuts.status.openAtLoginApproval`；批准后回到设置窗口即显示为开启。其他未生效的开启会报错。

验证：打包版（隔离配置、CDP）读取到 `openAtLogin: false`，全程未切换登录项；按视口宽 1280、1000、760、759、480、479、320 与 760 × 420 核对页脚，英文与 zh-CN 均无溢出和横向滚动，换行位置与 Figma 各布局变体一致；悬停三个开关均无 tooltip。未验证：真实开启、`requires-approval` 流程与 Windows（避免给本机注册登录项）。

差异：Figma 中恢复默认按钮单独换行时位于行首，代码用 `ml-auto` 保持在行尾；最小宽度按英文文案取值，zh-CN 文案未在 Figma 中单独验证。

## 2026-09-28 插件化扩展设置

扩展设置改为以插件为顶层条目，详见 [计划](plans/2026-09-28-plugin-grouped-extensions-settings.md)。Figma 组件页新增 [19 · Plugin-grouped extensions](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1589-65641)，产品页新增 [S5](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1595-67144)，包含 320–1280px 列表、插件详情与安装页，以及菜单、抽屉和短高状态。

- 同日后续修订（用户确认）：列表改为 [Plugin card · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1610-75888) 卡片网格，对应 `plugin-card.tsx` 与 shadcn `Card` size sm：16px 内边距与区块间距、24px 圆角、36px 图标环、标题 14px Medium；已安装插件在名称下显示「来源 · 版本」，描述两行截断，底部为内容摘要与状态徽标。网格列最小 240px、间距 12px。深色填充对应代码 `bg-input/40`，Figma 用新增变量 `card/surface`（6% 白）与 `card/ring`（10% 白）表达，因为绑定变量的颜色透明度取自变量本身。
- 卡片上的 More 只在有更新、配置或卸载操作时出现（Show More 属性），隐藏时保留 28px 列宽，使开关位置一致；Core、个人和共享技能不显示 More。旧 [Plugin row](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1589-66279) 保留但列表页已不再使用。
- 分组只有「内置」与「个人与共享」，已安装插件归入后者；原「已安装」分组及其空状态已移除，安装入口在 [Add 菜单](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1591-66028)，其「创建」分组末项新增「记忆」。
- 记忆不再是单独插件，而是「个人」的一部分，且仅在有记忆条目时出现；插件详情按分类使用 [Plugin kind tabs · Rhea](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1614-74934)（每个 Tab 带数量，记忆除外，Tab 内分组不再显示标题）。[Plugin sub-page](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1593-66734) 新增 Personal · Memory tab 与 Personal · Empty 状态。
- 已知差异：Figma 换行网格无法保留空列，少于列数的卡片会被拉宽；320px 下放不下的 Tabs 在 Figma 中被裁切，代码为横向滚动；插件详情页头部的徽标位置沿用旧头部组件；搜索结果只在组件说明中描述，未单独绘制。
- 设置导航 [Settings sidebar](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=256-1024) 已包含 Extensions 与 Permissions，两项文案现在同样由 `Content/Settings navigation/*` 字符串变量拥有。上文 2026-09-12 记录的四项导航是当时状态。
- 已知差异：共享 Badge 使用 Geist SemiBold 12/16，代码 Badge 为 Inter 12 Medium（与现有技能行相同）；诊断块使用项目自有的 Rhea Alert 版本，因为共享库只有 Nova Alert。

## 2026-10-01 个人 › 记忆标签显示真实列表

用户要求插件详情的记忆标签显示真实记忆，而不是一个入口行；随后确认学习开关只由「记忆」分区拥有（标签里不再重复），标签里也不再保留跳转到「记忆」分区的入口。上文「记忆除外」与 Memory 分组的开关、计数描述已被取代。

- 代码：`features/service/plugin-memory-group.tsx` 复用 `features/memory/memory-list.tsx` 的行与 `memory-delete-dialog.tsx`，与「记忆」分区共用 `use-memory-snapshot.ts`；行点击经 `useOpenSettingsMemory` 打开「记忆」分区的编辑页，More 可在原地删除。标签内只有记忆列表，没有开关或入口按钮。记忆 Tab 与其他 Tab 一样显示条目数。
- Figma：[Personal · Memory tab](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1614-75986) 移除学习行，只保留记忆列表；[Plugin kind tabs](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1614-74934) 的 Memory 带数量；[Plugin item row](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1590-66093) 新增「More only」记忆行类型并删除旧 Memory 变体。S5 消费者已继承。
- 记忆来源追溯经评估暂不实现：写入路径已限于任务内的记忆工具调用与根运行学习器，Hermes 补丁冻结且条目以内容哈希为 id、学习器只报告「已变化」，旁路账本只能靠差异推断，会与单一权威（D7）产生漂移。
- 已知差异：「记忆」分区画面（C · 04.01–04.05）仍用较旧的 [App / Memory item](https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=339-1153)（无类型图标、编辑按钮而非 More），与代码列表不一致，尚未迁移。
