# AI

一个安静的桌面任务面板，默认停靠在屏幕右下角。根据 [Figma 设计 1:400](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1-400) 实现，使用本地 Inter 字体、[Lucide](https://lucide.dev/) 图标和半透明深色表面。代码通过 `lucide-react` 按需导入 History、Settings、X、Plus 和 ArrowUp；设计稿引用 [00 · Icon 图标库](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=14-91) 中对应的组件，其中 History 对应 `rotate-ccw-clock`。图标库由官方 Lucide Figma 插件导入，可通过 MCP 按名称复用。

图标按钮、面板标题栏和输入框的主组件位于 [02 · App components](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=69-80)，页面同时展示按钮状态、组件用例和样式变量。产品设计通过组件实例复用控件，使用属性切换状态、文字和图标，布局容器保留为自动布局 Frame。桌面模板组件位于 [00 · Desktop assets](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=0-1)；所有组件、样式和变量均保存在同一文件，可直接通过 MCP 查找和复用。

![AI task panel](docs/task-panel.png)

图中为渲染层布局预览；macOS 桌面窗口的原生材质会随背后的桌面内容变化。

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
- 与 Figma 一致的字体、布局、图标及空状态；macOS 的外部圆角和背景由系统原生材质绘制。
- Enter 保存任务，Shift + Enter 换行，中文输入法确认候选词不会误提交。
- 添加或移除附件，每条任务最多 6 个；仅保存文件名、类型与大小，不读取或持久化文件内容。
- 最近 50 条任务保存在本设备，可通过历史面板重新打开；切换面板或隐藏窗口时保留当前输入草稿。
- 显示/隐藏、全局快捷键、置顶设置、键盘焦点、提示和减少动画支持。

**尚未接入 AI 服务。** 发送操作会保存本地任务，界面会明确显示这一状态。任务保存逻辑位于 `apps/desktop/src/lib/task-store.ts`；后续可在主进程接入模型服务，并通过受限 preload API 与界面通信。不要把 API 密钥放入 `VITE_*` 变量。

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

主进程启用 `contextIsolation`、`sandbox`，关闭 `nodeIntegration`，禁止外部导航、弹窗和权限请求。preload 暴露只读平台信息，以及隐藏窗口、读取窗口状态、设置置顶三个接口，并在主进程校验调用来源和参数。

macOS 使用深色原生 HUD vibrancy，窗口圆角、边缘高光和阴影由系统统一绘制；渲染层背景完全透明，不叠加 CSS 面板底色、圆角、描边或模糊。网页预览与其他平台保留设计中的半透明表面；不同系统、桌面壁纸和窗口管理器的效果可能不同。生产包使用严格 CSP；仅本地开发服务器允许 React Fast Refresh 的内联初始化脚本。

任务使用本应用的 localStorage，未加密。存储损坏时恢复为空状态，写入失败时提示仅在当前会话保留。当前输入草稿不跨应用重启持久化。

设计和资源归属见 [设计来源](docs/design-source.md)，实施记录见 [计划](docs/plans/2026-09-09-ai-desktop.md)。
