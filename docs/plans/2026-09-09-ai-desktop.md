# AI desktop bootstrap and Figma UI

Status: Implemented; final verification and GitHub push in progress
Created: 2026-09-09
Approval: User authorized planning, initialization, implementation, and GitHub push in the original request.

## Summary

在空目录 `/Users/zen/Documents/ZProject/ai` 初始化 pnpm + Turborepo 工作区，用最新稳定版本的 Vite、Electron、React 19、TypeScript、Oxc 工具链、shadcn/ui 与 Vitest 实现桌面任务面板。目标为 [Figma 1:400](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1-400)，尺寸 420 × 580，默认定位屏幕工作区右下角，距边缘 16px。保留原设计的 Inter 字体、图标资源、颜色、间距与半透明表面。

已核验 npm latest（2026-09-09）：Vite 8.2.2、Electron 44.2.0、React/React DOM 19.2.8、TypeScript 7.0.2、Turbo 2.10.12、Vitest 5.0.0、Oxlint 1.82.0、Oxfmt 0.67.0、shadcn CLI 4.21.0、Tailwind 4.3.3、pnpm 12.3.4。通过精确版本和 lockfile 固定安装结果。

## Clarifying Questions

- GitHub 已登录账号 JUNERDD；当前目录尚无 Git 仓库，JUNERDD/ai 尚不存在。
- 用户已确认创建 `JUNERDD/ai` 私有仓库。
- 默认实现 UI 与本地交互（输入、附件列表、保存任务、历史、置顶设置、隐藏/唤起），未要求模型供应商或 API，因此不接入真实 AI 服务、不伪造生成结果。
- 以当前 macOS 环境验证桌面体验，保留 Windows/Linux 的标准 Electron 构建配置。

## File And Code References

- `package.json`, `pnpm-workspace.yaml`, `turbo.json`：工作区、版本、任务依赖与缓存。
- `packages/typescript-config/`：共享严格 TypeScript 配置。
- `packages/ui/src/`：shadcn 组件、cn 工具、Figma 主题变量。
- `apps/desktop/vite.config.ts`：Vite 8、Oxc React 插件、Tailwind、Electron 主进程与 preload 构建。
- `apps/desktop/electron/main.ts`, `preload.ts`, `window-position.ts`：透明窗口、工作区定位、受限 IPC 和生命周期。
- `apps/desktop/src/`：任务面板、状态管理、任务/附件本地存储、精确导出图标。
- `apps/desktop/tests/`：Vitest 行为测试及 Electron 冒烟测试。
- `.github/workflows/ci.yml`, `README.md`, `docs/design-source.md`：CI、开发/打包说明和设计来源。
- 云端 Figma get_design_context、get_metadata、get_variable_defs 均成功读取 file `D9YK1tEeBTEBgstcepesW5` node `1:400`；不需要本地 Figma 回退。
- [Vite 8 / Oxc](https://vite.dev/blog/announcing-vite8)、[vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron)、[shadcn Vite](https://ui.shadcn.com/docs/installation/vite)、[Electron releases](https://releases.electronjs.org/)、[Turborepo workspace](https://turborepo.dev/docs/getting-started/add-to-existing-repository)。

## Plan Todos

- [x] P1：读取目录、GitHub 状态、Figma 节点和最新版本；完成计划。
- [x] P2：初始化 Git、pnpm/Turbo 工作区、共享配置、Vite/Electron/Oxc/shadcn/Vitest 工具链。
- [x] P3：实现安全 Electron 主进程/preload、右下角定位、显示/隐藏和置顶控制。依赖 P2。
- [x] P4：下载原始图标，匹配 Figma 面板，补齐输入、附件、历史和设置交互。依赖 P2/P3。
- [x] P5：运行格式、lint、类型、Vitest、生产构建、Electron 启动/定位/IPC 和视觉验证，修复发现的问题。依赖 P3/P4。
- [ ] P6：完善 README、来源与 CI；创建/确认 GitHub 仓库、提交推送并验证远端。依赖 P5。

## Grill-Me Outcome

- Transcript: Not run
- Outcome: Not run
- Summary: 用户没有要求访谈；设计、目录和低风险默认值已足够明确，不引入额外审批流程。

## Build From Plan

- Ready to build: Yes
- Selected todos: P1–P6
- Execution notes: 原始请求已授权全流程；建立计划不新增实施审批。先完成本地工程和验证，再推送具体可审阅结果。
- 使用 `vite-plugin-electron@1.1.2` 的已支持 Vite 8 接口；`electron-vite@5` 的 peer 范围只到 Vite 7，故不使用。
- 渲染进程通过 contextBridge 暴露窄接口；启用 contextIsolation/sandbox，关闭 nodeIntegration，阻止外部导航。
- 窗口按 Electron workArea（逻辑像素）计算，考虑负坐标副屏与小屏，避免覆盖 Dock/任务栏。macOS 原生磨砂、其他系统透明背景的效果可能不同。
- 用 shadcn CLI 引入基础组件并按设计变量定制；图标下载原始资产到仓库，避免七天过期链接。
- 开发入口 `pnpm dev`；网页预览 `pnpm dev:web`；打包入口 `pnpm package`。用户补充要求一键启动开发环境，已实际验证 `pnpm dev` 同时启动 Electron/Vite、CSS 热更新保留草稿、配置变更重启应用、Ctrl+C 退出。
- 修正插件将 loopback 解析为 localhost 的兼容问题；只允许本机地址，并在 dev/生产两种启动路径保留 Chromium sandbox。

## Validation

- 最终通过 `pnpm check`：格式、Oxlint（含 350 行限制）、TypeScript、13 项 Vitest、Vite 生产构建。
- 最终通过真实 Electron 冒烟测试，包含 328×448 窄窗口检查；生成 `apps/desktop/.artifacts/electron-panel.png` 和 `electron-compact.png`；成功生成 macOS arm64 未签名应用。
- Vitest 验证多显示器工作区定位与小屏边界；验证输入空白/IME、任务保存/历史恢复、附件与受限桌面接口。
- Electron 实际启动检查窗口尺寸/右下角位置、预加载桥、置顶、隐藏与重新显示，截图对照 Figma。
- Aside 浏览器实测 1440×900 视口下面板 420×580，位于 (1004,304)，输入卡片高度 88px，无横向溢出；窄窗口通过 Electron 测试验证。
- 尝试本机未签名应用打包；签名、公证和发布安装包不属于本次 GitHub 推送。
- `git status`、`git log -1`、`git ls-remote origin` 核对工作区和推送 SHA。

## Risks

- 最新工具版本可能带来兼容变化：通过 peer 核验和实际安装/构建解决；不无声降级用户要求的主工具。
- CSS backdrop-filter 不能保证跨窗口采样桌面；macOS 使用 Electron 原生 vibrancy，其他平台采用透明背景并记录限制。
- 本地存储有容量/隐私边界：仅保存用户输入与附件元数据，明确尚未接入 AI；损坏或不可用存储不能导致白屏。
- 全局快捷键可能被其他软件占用：检查注册结果，保留系统菜单/窗口恢复路径。
- GitHub 仓库若在创建前出现，则重新检查而不覆盖已有远端内容。

## Approval

- Status: Implementation and push authorized by the original request.
- Scope: P1–P6，当前目录新工程、UI 实现、验证、提交及 GitHub 仓库推送。
- Repository preference: User confirmed private `JUNERDD/ai`.
