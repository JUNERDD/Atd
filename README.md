# AI

一个安静的桌面 Agent 任务面板，默认停靠在屏幕右下角。当前实现依据[产品流程与设置](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1-251)与[应用组件](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=69-80)，使用本地 Inter、Rhea shadcn 组件、Lucide 图标和原生 macOS 材质。

项目 Figma 文件拥有应用组合与产品变量，共享控件和 Lucide 引用[批准的 shadcn UI kit](https://www.figma.com/design/tEV8H6Msibbc64Dds5eehO/shadcn-ui-kit-community-edition--Community-)。品牌 SVG 保存在 `packages/ui/src/assets/brands/`；对应实现与验收记录见[设计来源](docs/design-source.md)。

![AI task panel](docs/task-panel.png)

图中是早期渲染层预览，不代表本轮视觉验收；macOS 原生材质会随桌面内容变化。

## 开始开发

需要 Node.js **24.19.0**（见 `.node-version`）和 pnpm **12.3.4**。

```sh
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` 同时启动 Vite 和 Electron。React 界面支持热更新，主进程或 preload 修改后自动重启 Electron；终端按 **Ctrl + C** 一并退出。macOS 可通过 **⌘ ⇧ Space** 显示或隐藏面板；Windows/Linux 使用 **Ctrl + Shift + Space**。也可以通过应用菜单恢复面板，快捷键被占用时保留 Dock/任务栏恢复路径。

仅在浏览器中预览：

```sh
pnpm dev:web
```

打开 <http://127.0.0.1:5173>。网页预览与 Electron 共用 UI；置顶设置仅在桌面应用中启用。两个开发命令使用同一端口，请分别运行。

## 当前功能

- 420 × 580 面板，距屏幕可用区域右侧和底部各 16px；支持副屏、负坐标和小工作区。
- 多个具名提供商连接、独立凭据和默认模型；目录来自 Pi 注册信息，并提供本地与自定义连接入口。
- 流式对话、历史与后续消息；接受时保存运行快照，默认值改变不会替换已接受的模型。
- 自定义命令、Mustache 变量、参数、快捷键、工具与记忆设置；AI 生成指令先预览，采用后只改未保存草稿并支持撤销。
- 附件、选中文本与剪贴板上下文，文件变更和终端操作确认，以及本地记忆管理。
- 设置窗口在 760px、480px 断点切换侧栏、顶部导航和抽屉；长表单滚动，页脚操作保留。
- Enter 发送、Shift + Enter 换行，中文输入法确认候选词不会误提交；切换或隐藏面板保留当前草稿。
- 显示/隐藏、全局快捷键、置顶设置、键盘焦点、提示和减少动画支持。

实际模型请求需先在桌面应用 Providers 中保存可用连接、选择默认模型并将其设为默认提供商。网页预览不具备桌面桥接能力。凭据通过主进程的 Electron safeStorage 加密，不能放入 `VITE_*` 变量。最新实现与未运行的验收范围见[提供商计划](docs/plans/2026-09-12-provider-defaults-design.md)。

## 技术栈

以下为 2026-09-09 从 npm `latest` 核验并锁定的版本：

| 工具              | 版本            | 用途                                              |
| ----------------- | --------------- | ------------------------------------------------- |
| Vite              | 8.2.2           | Rolldown 构建，Oxc 转换与压缩                     |
| Electron          | 44.2.0          | 桌面窗口、快捷键、隔离通信                        |
| React / React DOM | 19.2.8          | 面板界面                                          |
| TypeScript        | 7.0.2           | 严格类型检查                                      |
| Turborepo         | 2.10.12         | 工作区任务依赖与缓存                              |
| Oxlint / Oxfmt    | 1.82.0 / 0.67.0 | 检查与格式化                                      |
| shadcn CLI        | 4.21.0          | 生成并持有 Button、Textarea、Switch、Tooltip 源码 |
| Tailwind CSS      | 4.3.3           | shadcn 样式与主题变量                             |
| Vitest            | 5.0.0           | 状态和界面行为测试                                |

`@vitejs/plugin-react@6.1.1` 使用 Oxc 处理 React Fast Refresh；`vite-plugin-electron@1.1.2` 已支持 Vite 8。没有引入 Babel 或 SWC 转换链。所有直接依赖均精确锁定，安装使用 `pnpm-lock.yaml`。

## 工作区

```text
apps/desktop/
  electron/              主进程、受限 preload、窗口定位
  src/                   React UI、本地状态、Figma 资源
  tests/                 测试环境与真实 Electron 冒烟测试
  vite.config.ts         Vite/Oxc/Electron 构建配置
  electron-builder.yml   macOS、Windows、Linux 打包配置
packages/
  ui/                    共享 shadcn 组件与 Figma 主题变量
  typescript-config/     共享 TypeScript 配置
docs/                    实施计划、设计来源、截图
```

添加 shadcn 组件：

```sh
pnpm dlx shadcn@4.21.0 add dialog -c apps/desktop --yes
```

组件通过工作区配置生成到 `packages/ui/src/components`。`cn` 工具使用 `@ai/ui/lib/utils`，运行 CLI 后检查导入路径与依赖变更。

## 验证与打包

```sh
pnpm check            # 格式、Oxlint、TypeScript、Vitest、生产构建
pnpm test:electron    # 真实 Electron 启动、定位、隔离、任务恢复及窗口控制
pnpm package          # 当前平台的未签名应用目录
```

单独运行：`pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。

macOS 打包结果位于 `apps/desktop/release/mac-arm64/AI.app`（Intel 机器为 `mac`）。`pnpm --filter @ai/desktop start` 可直接运行生产构建。安装包配置也已保留，可运行 `pnpm --filter @ai/desktop exec electron-builder --publish never` 生成当前平台的 dmg / nsis / AppImage。正式分发前需要配置相应签名和公证。

GitHub Actions 包含 Linux 工程检查，以及 macOS 的 Electron 冒烟测试和应用目录打包。Windows/Linux 的安装包尚未在本机验证。

## 实现说明

主进程启用 `contextIsolation`、`sandbox`，关闭 `nodeIntegration`，限制外部导航、弹窗和权限请求。preload 通过窄类型接口暴露窗口、设置、连接和 Agent 操作；主进程校验调用来源与参数。模型凭据不会进入渲染层或任务快照。

macOS 使用深色原生 HUD vibrancy，窗口圆角、边缘高光和阴影由系统统一绘制；根元素保持透明，内容颜色由共享 token 填充层负责，不叠加外部 CSS 圆角、描边或桌面模糊。网页预览与其他平台保留设计中的半透明表面；不同系统、桌面壁纸和窗口管理器的效果可能不同。生产包使用严格 CSP；仅本地开发服务器允许 React Fast Refresh 的内联初始化脚本。

设置和 Agent 数据保存在 Electron userData 下，通过原子写入更新。任务和会话内容是本地持久化数据，凭据单独加密；读取损坏时保留原文件并提示错误。旧 localStorage 任务通过既有迁移入口导入；输入草稿不跨应用重启持久化。

设计和资源归属见[设计来源](docs/design-source.md)，运行边界见[通用 Agent 计划](docs/plans/2026-09-10-general-agent-requirements.md)，最新连接设计与实现见[提供商计划](docs/plans/2026-09-12-provider-defaults-design.md)。
