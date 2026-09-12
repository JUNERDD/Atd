# 设计来源与实现记录

更新日期：2026-09-12。当前入口为 [01 · Product design · Flows & settings](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1-251)。用户已授权界面、真实 Agent 与持久化一并实现，并授权使用独立数据目录验证 Electron。

Agent 流程与 Providers / Shortcuts 设置已合并到同一设计页：[统一导览](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=577-11193)串联 A–E 任务、命令和记忆，F1–F9 提供商，以及 G 快捷键；Q1/Q2 保留视觉验收和渲染参考，Z 保留原型内部状态。原画板节点、组件引用和原型路径继续保留。本次页面合并未修改应用代码。

## 设计与组件映射

通过云端 Figma MCP 读取画面、主组件、变量、样式与截图。项目画面与适配组件保留在 [ai 项目文件](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai)；共享 Radix / Rhea 控件与 Lucide 实例保留 [shadcn UI kit](https://www.figma.com/design/tEV8H6Msibbc64Dds5eehO/shadcn-ui-kit-community-edition--Community-) 连接。本次没有修改共享库。

以下代码路径相对于 `apps/desktop/src/`。

| 设计源                                                                                                                                                                       | 代码拥有者                                                                                          | 实现内容                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Panel header](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=71-112)、[Composer](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=72-150)     | `App.tsx`、`components/composer.tsx`、`features/agent/use-task-panel.ts`                            | 新建、历史、设置、草稿、发送、停止与后续消息设置                |
| [任务执行](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=622-3727)、[会话轮次](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=693-4071)     | `features/agent/conversation.tsx`、`tool-activity.tsx`、`task-request.tsx`                          | Pi 消息、真实工具步骤、输入/权限确认、队列、停止与中断恢复      |
| [Command management](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=373-1416)                                                                                | `features/commands/command-settings.tsx`、`command-editor.tsx`                                      | 同构示例与自定义命令、Run / Switch / More、版本冲突、复制、删除 |
| [指令编辑器](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=417-1716)、[变量选择器](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=439-2067) | `features/commands/instruction-editor.tsx`、`instruction-extensions.ts`、`variable-picker.tsx`      | 高亮、光标处插入、变量说明、未启用来源的配置入口                |
| [参数字段](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=410-1982)、[参数定义](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=414-1817)     | `features/commands/parameter-editor.tsx`、`parameter-field.tsx`、`features/agent/command-input.tsx` | 文本、数字、选项、布尔字段；共用校验、默认值与运行预览          |
| [文件结果](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=433-2044)                                                                                          | `features/agent/task-files.tsx`                                                                     | 文件信息、路径、打开、显示位置、复制、继续使用、重新关联        |
| [Memory item](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=339-1153)                                                                                       | `features/memory/memory-settings.tsx`                                                               | Hermes 记忆列表、搜索、修改、删除与暂停学习                     |

上述项目主组件的 usage description 已同步代码映射。Figma 原型继续使用固定样例表达有限状态，应用中的数据与执行状态来自运行时。

## 视觉约束与最新修正

- 采用仓库的 `b27GcrRo`：Radix / Rhea、Inter、Neutral、Lucide；控件复用 `packages/ui`，按钮、输入框、选择器与菜单保持各自变体的几何与状态。
- 面板默认 420 × 580，标题栏 48px 加 1px 分隔线。macOS 的外部圆角、材质、边缘与阴影由原生 HUD 窗口拥有；渲染层保持单一共享表面填充，不叠加 CSS 窗口描边或阴影。
- 按用户反馈移除会话 `margin-top: auto`。短对话首条消息从标题栏下方 20px 开始，Composer 固定在底部；长对话滚动至最新内容由滚动逻辑负责。
- [共享会话说明](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=694-17333) 与 [短回复示例](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=796-15567) 已同步顶部排列。长内容原型中展示“滚动至最新”的有限状态不代表运行时垂直布局规则。
- 已检查实际 Electron 内容截图及白色 / 蓝色背景上的 OS 合成窗口，覆盖四角、边缘、阴影和原生材质。证据在 `apps/desktop/.artifacts/agent-result-top-aligned.png`、`agent-native-contrasting.png`。

### 设置二级页标题统一

用户确认以 New command 的「左箭头 + 标题同一行」为准。提供商接入、连接详情、命令与参数编辑、上下文来源、记忆编辑及独立删除确认页共 58 个画板，统一复用 [App / Settings subpage header · Rhea](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1045-32910)。一级设置页保留各自总览标题。

返回控件复用 `App / Icon button` 的 Ghost / icon-sm：28 × 28px，连接共享 `Lucide / arrow-left` 的 16px 图标；与 Inter Semi Bold 24px / 32px 标题相距 8px，垂直居中。可选说明使用 Inter Regular 14px / 20px，与标题行相距 8px。组合 Fill 宽度、Hug 高度，长标题自然换行；Desktop 保留设置内容 40px 内边距，窄屏遵循响应式模式。代码对应 `features/commands/commands.css` 的 `.editor-heading` 与 `components/icon-button.tsx`。

组件暴露标题、说明、说明显隐及嵌套返回按钮。原型导航由返回控件的容器承担，避免按钮状态切换覆盖返回目标；可访问名称与 tooltip 应说明返回的上级页面。保留既有导航，并补齐记忆编辑、独立确认页及 Anthropic 连接详情遗漏的返回入口。此次仅修改 Figma 与文档，提供商功能的后续实现沿用 [提供商计划](plans/2026-09-12-provider-defaults-design.md#二级页面标题)。

### 表单分组与间距

2026-09-12 按用户截图修正 25 个命令、参数和上下文编辑画板，并同步命令运行输入页与字段宽度评审。普通命令字段／分组之间使用 16px，标签到控件、说明和变量快捷入口之间使用各自分组内的 8px。保留 Rhea 标签 14px / 14px、32px 控件和输入／快捷键共享组合；提供商的 24px 大分区、选项编辑的 12px 组内行距继续按各自组合使用。

15 个命令画面复用 [App / Command run settings · Rhea](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1062-33204) 的展开／收起变体。展开入口到内容为 16px；Model／Memory 在宽度充足时并排，Allowed tools 单独组成标签与开关组。复用既有 `Spacing / 16`（Standard）与 `gap/layout`，保留按钮、Select、Switch 的连接及原型目标。编辑页标题、滚动内容和页脚之间为 16px；Desktop 的内容 inset 为上／右／下／左 40／40／32／40px，窄屏值由响应式模式拥有。

[输入选项](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=440-6995) 的新增参数入口与列表标题共用一行，参数列表 Hug 高度，行距 8px；第五项不再被固定高度隐藏。滚动由表单区域承担，页脚位置固定。[指令编辑器](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=417-1716) 保留 96px 最小高度并随内容增长，防止长指令溢出到说明文字。已检查展开／收起、长内容、字段错误、变量弹层、五项参数和窄字段截图，并读回布局与原型引用。

此次按用户约定只修改 Figma 与 plan。后续实现需同步 `run-settings.tsx` 的展开间距和组合、`input-options.tsx` 的列表标题操作，以及指令编辑器的内容高度；现有代码的 `pt-3` 和运行设置排列尚未按本次设计调整。详见 [计划中的表单间距修正](plans/2026-09-10-general-agent-requirements.md#2026-09-12--表单间距修正仅-figma)。

### 设置页组件归属统一

2026-09-12 按用户要求统一优化 Figma，并同步 plan。此前 sidebar 虽然全部是实例，8 个主变体仍保留旧文案，55 个 Providers 页面另有文字覆盖；连接了图标或按钮也不能代替其外围布局的复用。

- [Settings sidebar](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=256-1024) 的四项固定文案改由 `App · Controls / Content/Settings navigation/*` 字符串变量拥有。清理 55 处旧文案覆盖后，当前 93 个设置／菜单画面统一显示 Providers、Commands、Memory、Shortcuts。24 个变体覆盖四个 Tab、两种 Hover 和 Sidebar／Top／Drawer 布局；全部移除 logo、头像和姓名，保留原生窗口控件。页面只配置导航状态、布局和目标。
- [Settings editor layout](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1093-34262) 与 [Settings editor footer](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1093-34242) 替代 25 组复制的编辑页与页脚。主组件统一拥有响应式 inset（Desktop 为 40／40／32／40px）、16px 分区间距、共享二级标题、有界垂直滚动 SLOT，以及滚动区外的页脚。各页保留自己的表单、反馈、操作文案、禁用状态和原型目标。
- [Command identity](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1093-34209) 替代 15 组独立的名称／描述列。当前响应式版本使用随标签一起换行的字段列：每列最小 220px，列／行间距 16px、标签到控件 8px，可用宽度小于 456px 时堆叠。固定标签绑定文案变量并在最小列宽内保持单行，值和状态通过暴露的 Command field 实例编辑；更长的本地化标签需堆叠或使用共享标签／控件轨道，不能单独偏移输入框。
- 131 个独立共享库按钮迁入既有 [Settings action · Rhea](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=907-17188)，统一 Label、前置图标、Primary／Outline／Ghost 与 Default／Hover／Focus／Disabled。保留连接的共享库外观层和 Lucide 图标；项目组件直接拥有标签属性，因为共享按钮源未提供文本属性。状态切换由项目组件负责，避免内层跳回共享库外观；禁用透明度只在整个按钮应用一次。
- 39 个独立输入框迁入既有 [Command field · Rhea](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=410-1982)。Text 增加 Value／Placeholder 内容变体并覆盖五种交互／校验状态，复用共享 Input 的 Value 属性；独立搜索或外部标签组合关闭 `Show label`。32px 高度、18px 圆角与 token 由源组件拥有。

页面导航放在按钮外的透明 Auto Layout 动作容器，按钮实例只继承组件状态反应，避免 hover 切换覆盖点击目标。产品页的 178 个按钮导航保留原目的地；组件定义与组件页 QA 只提供外观参考。

保留当前批准的 hover：Ghost 白色 10%、Outline 白色 4.5%、Primary 为 `primary/80`；焦点使用 ring 边框与 3px、30% 的焦点环。未修改共享 shadcn 文件。组件页新增 [09 · Shared settings layouts](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1093-34208)，记录使用方式及宽窄窗口、换行和状态样例。

已复核标准编辑页、Memory、五项参数、长指令、校验错误、按钮及输入框状态；早期控件迁移的标准命令页与 Memory 截图一致。后续响应式修正允许窄字段堆叠，760 × 560px 窗口通过有界正文滚动保留页脚。产品页保留 26 个分区和 25 个原型起点。本条修正仅涉及 Figma 与文档，应用共用编辑布局的后续同步见 [组件统一计划](plans/2026-09-10-general-agent-requirements.md#2026-09-12--设置页组件统一仅-figma)。

### 命令菜单内边距归属（仅 Figma）

2026-09-12 复核 [命令操作弹层](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=380-3063)：实际内容已有 4px 内边距，与 `packages/ui/src/components/dropdown-menu.tsx` 的 `DropdownMenuContent p-1` 一致，并非零内边距。问题是这 4px 位于材质 SLOT 内的独立 Frame；外壳和菜单项虽然连接了组件，完整动作布局仍可能由各实例独立保留。

[Command actions menu · Rhea](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=487-11060) 的 Enabled／Disabled 主组件现在直接拥有绑定既有间距变量的 4px Auto Layout padding 和五个连接菜单项。`App / Popover surface · Rhea` 继续连接共享库，仅作为铺满组件的材质层，其内容 SLOT 留空。两个产品实例的旧内容 Frame 已清理，九个点击目标、禁用 Run 的 50% 透明度及无动作状态保留。菜单行仍为 32px 高、左右 8px／上下 6px 内边距和 14px 圆角；没有套用通用 `PopoverContent p-4` 的 16px 规格。

实测临时调整源组件 padding 后，两处产品实例同步重排，随后恢复正式 4px；Enabled／Disabled 在 192、224、288px 菜单宽度下的六项原生布局检查通过。默认 224×168px，首行距顶部和左侧均为 4px，末行距底部为 4px；材质始终铺满。启用态整个画板的前后 PNG 完全一致，禁用态另已视觉复核。这次修正的是布局归属，不宣称先前已有数值漂移。当时只确认其余 16 个相关产品弹层拥有连接的内容组件，没有证明它们的累计内边距正确；后续发现与修正见下文深度排查。旧版菜单仅在已弃用源与 QA 中保留。使用说明、[项目 plan](plans/2026-09-10-general-agent-requirements.md#2026-09-12--全界面响应式布局仅-figma) 和 AGENTS.md 已同步。

### 弹层内边距深度排查（仅 Figma）

2026-09-12 根据 [变量补全实例](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1123-43441) 再次核对主组件、实际材质、SLOT、内容、分组和高亮边界。这次问题写在主组件内部：外层四边 4px，Suggestion group 又额外添加左右 4px，实际高亮边距成为上 4px、左右 8px。组件连接正常会把错误一起传给消费者；此前仅检查连接和单层 padding 的验收不充分。

| 发现                     | 源组件修正与当前结果                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 补全高亮左右多出 4px     | [Variable menu content](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=507-4022) 的 Suggestions 只保留根组件四边 4px，选项组不再叠加水平 inset。首行高亮到材质上／左／右均为 4px，选项与底部提示文字的左边线均为 12px。                                                                                  |
| 补全短高时整体裁切       | [Command variable suggestions](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=484-2844) 的材质、SLOT、内容共同 Fill 受限高度；仅选项组滚动，底部提示 Hug 并保持可见。由 18px 圆角材质裁切内容，取消产品实例外层方形滚动裁切。320px 长内容 QA 保留 226px 高度，清除内部固定高度覆盖，使其缩高时也能重排。 |
| 模型搜索框与选项错开 4px | [Model picker content](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=954-19478) 的 Default、No results、Catalog warning 均增加原生 CommandInput inset 容器，保持连接的 32px 输入框；搜索表面与选项高亮左右均为 8px、宽度相等。Composer 中的现有实例继承更新。                                           |
| 刷新失败提示右侧越界 4px | [Codex catalog warning](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=964-19967) 的 Refresh notice 从固定 320px 改为 Fill。在 320px 菜单内占 312px，左右外边距均为 4px，提示文字左右均为 12px；原失败画面已继承。                                                                                       |

完整可搜索变量选择器继续使用 Rhea Command 的 8px 搜索／选项高亮横向边距；行文字 16px 与底部提示文字 12px 来自不同用途的明确组合，不统一改成相同数值。DropdownMenu／Select 的 4px 边界、Tooltip 的上下 6px／左右 12px 也保留各自规格。

独立复核覆盖 25 个源／评审弹层和 18 个产品弹层，共 160 个菜单行外观层，未发现剩余行外观尺寸错配或横向区域越界；产品动作目标均可解析。另核对 36 个 Tooltip 实例，文字四边符合其规格。补全菜单验证 192／288／460px 宽度和 96／120px 短高，另在实际产品视口及 320px 长内容 QA 上验证高度传递并恢复评审尺寸；模型三个状态和刷新提示均验证 288px 窄宽。已检查实际画面、细节和短高截图，临时实例均已清理。

本轮按既定范围只修改 Figma 与文档。`instruction-theme.ts` 仍保留补全列表 `padding: '4px 8px'`，应用尚未同步本次 4px 补全边界及滚动／页脚调整；不把 Figma 修正当作运行时完成。后续同步要求见 [项目 plan](plans/2026-09-10-general-agent-requirements.md#2026-09-12--弹层内边距深度排查仅-figma)。

### 全界面响应式布局（仅 Figma）

2026-09-12 按用户要求覆盖各个尺寸，并将小屏抽屉及无 logo／账户信息的导航规则写入 [AGENTS.md](/Users/zen/Documents/ZProject/ai/AGENTS.md#responsive-layouts)。[响应式组件与评审区](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1117-35919) 集中展示导航、编辑器、各设置模块、变量弹层和任务浮窗。

| 可用窗口宽度 | 导航布局         | 内容处理                                                       |
| ------------ | ---------------- | -------------------------------------------------------------- |
| ≥760px       | 208px 侧栏       | Desktop inset：上／左右／下 40／40／32px，内容宽度最多 1000px  |
| 480–759px    | 可换行顶部导航   | Compact inset：16／16／16px，字段与操作区按可用空间换行        |
| <480px       | 菜单按钮打开抽屉 | 同 Compact inset；抽屉提供选中项、关闭按钮、遮罩和 Escape 关闭 |

[Settings window layout · Responsive](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1119-36110) 统一拥有窗口布局、导航和两个原生 SLOT：正文与视口内弹层。91 个原设置窗口与两处旧命令菜单载体均已迁入，共 93 个画面。两处菜单入口改为完整窗口状态导航，保留原画板 ID、菜单操作和返回目标。普通侧栏仍透明，所有布局均无 logo、头像或姓名。

抽屉在真实蓝色壁纸上复核半透明、背景模糊与共享选中色。窗口独占 Glass 80% 底色；抽屉独立表面复用 `surface/settings-content` 10% 局部材质并施加 40px 背景模糊，导航本身透明，选中态沿用 Glass 白色 12%。有效 30% 的遮罩只覆盖抽屉外区域，避免窗口、遮罩与抽屉三层底色叠加成近乎不透明。表面作为导航的同级节点保留变体间相同的导航层级，避免切换时丢失选中 Tab。[真实壁纸评审](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1187-38838) 展示关闭与打开两种状态。

`App · Responsive` 使用 Desktop／Compact 模式。内容的三个间距变量别名到已有 token，另一个布尔变量控制窄屏下不再适用的模型列表列标题；BOOLEAN 使用 API 支持的默认 scope。原生窗口控件另有横向／纵向 inset：Desktop 为 0／0px，Compact 为 12／4px，只作用于侧栏控件行，使抽屉打开／关闭时的三灯位置一致，保留桌面位置及导航行的内边距。名称／描述、Input／Shortcut、运行设置、目录筛选、连接校验和页脚使用原生换行；长表单／列表放在有界滚动正文，页脚及任务 Composer 保持可达。保留 Rhea 控件尺寸、字体、圆角与分组间距。

提供商行和命令行由各自主组件拥有响应式布局，继续连接共享 Item 外观层、品牌／Lucide 图标及项目控件。保留模型值、Default 标签、命令标题与说明、快捷键显隐及操作目标；比对后清理旧插槽副本。18 个设置弹层均受窗口范围和滚动容器约束；49 个任务浮窗及 8 个边界状态卡片使用伸缩、换行或有界滚动。

[变量选择器](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=439-2067) 的三个 Scope 统一使用固定头尾与中间选项滚动区。弹层表面、内容 SLOT 和实例一起 Fill 可用高度；视口裁切沿用表面的 18px 项目适配圆角，避免旧的高菜单被方形滚动外框截断。四处产品弹层与小屏 QA 已同步，16 个尺寸检查通过，标题、搜索、Done 和底部提示保持可见。

[Settings overview header · Rhea](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1181-38808) 拥有共同的标题／说明与管理工具栏，Toolbar 原生 SLOT 保留各页的搜索状态与按钮，消费者在其下方以 16px 间距衔接正文。标题到说明为 8px，标题区到工具栏为 16px；工具栏列距 12px、换行间距 8px，搜索最小 180px，主操作 Hug 并在窄屏换到搜索下方。Memory 搜索位于 Learn automatically 之前。Top／Drawer 导航下内边距为 8px，Compact 正文上 inset 为 16px，避免两个容器叠加过大的留白。

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
