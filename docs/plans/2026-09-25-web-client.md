# 网页端：与桌面端 1:1 同步的服务客户端

Status: Implemented - P1–P6 done; Figma not synchronized (see Remaining)
Created: 2026-09-25
Approval: 用户选定架构 A（服务端为唯一数据源）、仅本机浏览器访问、第一期覆盖对话与全部设置

## Summary

参照 OpenCode 的多端模型：`agent-service` 持有全部共享状态，桌面端和网页端都是订阅同一事件流的平等客户端。一端的操作（发消息、审批、改名、改命令、改设置、连接模型服务）会实时出现在另一端。

现状（证据见 File And Code References）：

- 服务端已持有任务、对话、运行、审批、队列、命令、模型服务、记忆、技能、角色、子代理、MCP，并通过 `/v1/stream` WebSocket 广播任务事件，支持多个连接。
- Electron main 不执行 agent，但仍是唯一能用这些数据的客户端：它把服务事件映射成渲染层的 `TaskDetail` / transcript patch，缓存任务，并持有四项设置（语言、新任务默认权限档位、shell 白名单、快捷键）。
- 浏览器进不来：服务要求 `Authorization: Bearer`（浏览器 WebSocket 无法携带），token 按设计不离开 main。
- 多端同步缺口：别的客户端新建的任务在事件到达时被丢弃（`service-tasks.ts` 对未缓存任务直接 `return`）；改名、删除、改档位没有事件；命令、设置、模型服务、扩展、记忆的变更没有任何通知；从命令发起的任务标题只写进 main 的缓存。

## Decisions

- [x] 架构 A：服务端为唯一数据源（用户选定）。
- [x] 访问范围：仅本机浏览器；服务继续只接受 loopback Host/Origin（用户选定）。
- [x] 第一期范围：对话面板 + 设置窗口全部页面（用户选定）。
- [x] **共享客户端核心**：把 main 里基于 `AgentClientOptions` 的适配逻辑抽成与平台无关的模块，放在 `apps/desktop/client/`，main 与网页端运行同一份代码。main 只剩 IPC 外壳和原生能力，网页端直接在浏览器里实例化核心并实现 `DesktopBridge`。不写第二套实现。
- [x] **浏览器认证不用 cookie**：cookie 不区分端口，同机其他端口的服务会收到它，而且会带来 CSRF 问题。改为配对后得到的会话 token：HTTP 用 `Authorization: Bearer <session>`，WebSocket 用子协议 `['ai.v1', 'ai.auth.<session>']` 携带。浏览器不会自动附带这个凭据，所以没有 CSRF 面。
- [x] **配对**：`POST /v1/web/pairings`（只接受服务主 token）签发一次性配对码（32 字节随机，5 分钟，单次使用）。浏览器打开 `http://127.0.0.1:<port>/#pair=<code>`，页面脚本 `POST /v1/web/session` 换取会话 token，存入 `localStorage` 后清掉 URL 片段。会话哈希后持久化在服务数据目录，30 天有效，服务重启不失效。会话 token 不能签发配对码、不能关闭服务、不能上传迁移凭据。
- [x] **入口**：桌面设置窗口右上角的「在浏览器中打开」（地球图标）与应用菜单 Open in Browser…；CLI `agent-service web [--open] [--base <origin>]`。开发时 `pnpm dev` 的渲染层开发服务器（`127.0.0.1:5173`）在浏览器中打开即为网页端：它把 `/v1`（含流）代理到桌面端启动的服务，每次请求重新读取服务端点，所以服务换端口也不用重启；页面通过开发服务器的 `/__ai/dev-pair` 自动配对，该接口只接受同源 POST（`Sec-Fetch-Site`）。桌面端的「在浏览器中打开」在开发时打开这个地址。
- [x] **静态托管**：服务通过 `@fastify/static` 托管 `vite build --mode web` 的产物（`apps/desktop/dist-web`），路径由 `--web-root` / `AI_AGENT_WEB_ROOT` 指定；桌面启动服务时传入开发或打包路径。未配置时 `/` 返回说明性 404。
- [x] **同步事件**：WebSocket 新增不按任务过滤的 `invalidate` 帧 `{ type: 'invalidate', scope, taskId? }`。scope 为 `settings | commands | providers | extensions | memory | task | task.deleted`。服务在变更路由成功后统一发出（按路由前缀映射，集中在一个 hook），客户端收到后通过 HTTP 重新拉取对应数据。事件循环里遇到未缓存任务的事件时，客户端先拉快照再应用。
- [x] **设置归属**：语言、新任务默认权限档位、shell 白名单、应用快捷键迁到服务端 `settings.json`（`GET/PATCH /v1/settings`）。服务端文件不存在时，第一个连上的桌面端用本地值做一次性初始化。窗口固定状态和面板尺寸仍留在桌面本地。
- [x] **命令任务标题**：提交后通过已有的 `PATCH /v1/tasks/:id` 写入服务端，不再只改本地缓存。
- [x] **网页端的桌面专属能力**：
  - 附件：用浏览器文件选择器，按同样的扩展名和大小规则上传到 `/v1/resources`。
  - 剪贴板：用 `navigator.clipboard`。
  - 选中文本捕获、系统文件搜索、全局快捷键注册、窗口固定/隐藏：网页端不提供，UI 按现有的「能力不可用」分支处理。
  - 外链：`window.open(..., 'noopener')`。
  - 产物：打开/复制/附加可用；在 Finder 中显示和定位不可用。
  - 设置：`#settings` 在新标签页打开。
  - 服务连接页：显示连接状态，不提供切换数据目录或启动本地服务。

## Ownership

| 数据 / 能力                                                              | 所有者     | 桌面端              | 网页端             |
| ------------------------------------------------------------------------ | ---------- | ------------------- | ------------------ |
| 任务、对话、运行、审批、队列、子代理对话                                 | 服务       | 共享核心            | 共享核心           |
| 命令、模型服务、技能、角色、子代理、MCP、记忆                            | 服务       | 共享核心            | 共享核心           |
| 语言、默认权限档位、shell 白名单、应用快捷键                             | 服务（新） | 共享核心 + 本地缓存 | 共享核心           |
| 全局快捷键注册、选中文本、系统剪贴板读取、原生文件对话框、文件搜索、窗口 | 桌面 main  | 原生                | 浏览器替代或不可用 |
| 服务进程生命周期、数据目录选择、旧数据迁移                               | 桌面 main  | 原生                | 不提供             |

## Phases

- [x] **P1 服务端接入**：会话认证（配对、会话存储、Bearer/子协议校验、会话权限范围）、静态托管、`invalidate` 帧、`/v1/settings`、CLI `web`。
- [x] **P2 客户端包**：流客户端改用 Node 24、Electron 与浏览器共有的标准 `WebSocket`，所有客户端都以子协议携带凭据，`agent-client` 不再依赖 `ws`；新增设置与网页会话的客户端调用；`fetch` 不再以方法形式调用（浏览器会报 Illegal invocation）。
- [x] **P3 共享客户端核心**：从 main 抽出任务缓存/事件归约、子代理对话订阅、命令缓存、模型服务与登录轮询、服务管理（技能/角色/子代理/MCP/记忆）、设置同步；平台钩子（发送事件、打开外链、选择文件、剪贴板）注入。main 改为薄 IPC 外壳，行为不变。
- [x] **P4 网页宿主**：`src/web/` 实现 `DesktopBridge`（`runtime: 'web'`，`platform` 为检测到的操作系统）、配对与重新配对界面、`--mode web` 构建（`dist-web`）、Vite 开发代理；原生窗口样式改为只在 `runtime: 'electron'` 时生效，`?preview` 保留无服务的纯渲染预览。
- [x] **P5 同步补齐**：两端处理 `invalidate` 帧与未知任务事件；命令任务标题写回服务；桌面「在浏览器中打开」。
- [x] **P6 验证**：typecheck、lint、现有测试；隔离数据目录启动服务，在浏览器中配对，打开面板和设置各页；两个标签页之间验证设置、命令、任务改名/删除的实时同步。

## Lifecycle

- 桌面端退出时仍会停止它启动的服务（沿用现状），此时网页端显示「重新连接」横幅并自动重试；只用网页端时，用 `agent-service serve` 独立运行服务。
- 会话持久化在服务数据目录，服务重启后浏览器无需重新配对；更换数据目录（serviceId 不同）会要求重新配对。
- 命令的全局快捷键只由桌面端注册；网页端可以编辑，冲突由桌面端在 `shortcutErrors` 中报告。

## Verification Results

- 服务：未带凭据的 API 与配对签发返回 401；配对码单次有效；浏览器会话调用 `/v1/web/pairings`、`/v1/admin/shutdown` 返回 403；非 loopback Origin 返回 403；WebSocket 仅协商 `ai.v1`，无凭据的升级被拒绝；一端修改设置后另一端收到 `invalidate` 帧。
- 网页端（隔离服务 + 本地假模型，不外发数据）：配对、刷新后免配对、对话流式渲染、设置六个页面、浏览器写入 shell 白名单并持久化、另一客户端改名/新建/删除任务实时反映、子代理钻取视图（只读消息、无输入框、返回后焦点回到胶囊）。
- 桌面端：`pnpm test:electron` 通过；隔离实例与网页端双向同步（桌面改默认档位和白名单 → 网页即时更新；网页发消息和切换语言 → 桌面任务列表与界面语言即时更新）；首次连接用本地设置初始化服务端。
- 静态检查：各包 typecheck 通过（`provider-settings.tsx` 的未使用变量来自另一任务未提交的改动）；改动文件 oxlint 无错误；vitest 54 项通过。

## Remaining

- Figma 未同步：本次新增的「在浏览器中打开」按钮、快捷键页的网页端说明、网页端登录页与网页端面板布局尚未进入项目 Figma 文件。
- 真实模型下的审批、提问与附件上传只在桌面端验证过原路径；网页端的文件选择器与剪贴板读取依赖浏览器权限，未在自动化中覆盖。

## Verification Notes

- 真实模型对话需要可用的模型服务凭据；隔离环境只能验证到连接、列表、设置和任务管理，无法完成一次真实回复时会在交付中说明。
- 桌面原生表面不在本次改动范围，桌面端回归依靠 typecheck、现有测试和 IPC 外壳保持原接口。

## File And Code References

- `apps/agent-service/src/auth.ts`、`apps/agent-service/src/server.ts:68-90`：Host/Origin/Bearer 三道检查。
- `apps/agent-service/src/stream.ts:69-74`：事件按任务过滤广播；`subscribe` 在无法重放时为全部任务发快照。
- `apps/agent-service/src/shell-policy-route.ts`：shell 白名单目前只存在内存，由 main 每次连接时推送。
- `apps/desktop/electron/agent/service.ts`：main 的 `AgentService` 基本是服务调用的薄适配。
- `apps/desktop/electron/agent/service-tasks.ts:103-230`：任务缓存与事件归约；未缓存任务的事件被丢弃；命令标题只写本地。
- `apps/desktop/electron/agent/child-transcripts.ts`：子代理对话订阅，按 `WebContents` 计数。
- `apps/desktop/electron/providers/service.ts`、`providers/login-client.ts`：模型服务写入与登录轮询，只在打开链接处依赖 Electron。
- `apps/desktop/electron/settings-store.ts`：四项需同步的设置目前存在桌面 `settings.json`。
- `packages/agent-client/src/ws-client.ts`：依赖 Node `ws` 并用请求头传 token；其余 12 处以同样方式拼 Bearer 头。
- `apps/desktop/src`：37 个文件经 `window.desktop` 访问宿主能力；`main.tsx` 以 `window.desktop` 是否存在区分 Electron 与网页。
