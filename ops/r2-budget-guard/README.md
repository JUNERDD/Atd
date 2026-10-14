# Atd R2 预算守护

`atd-r2-budget-guard` 管理 `TARGETS` 配置中的 Atd 公开入口：`atd-assets` 的 `assets.atd.best`、`atd-releases` 的 `downloads.atd.best`，以及这两个桶各自的 `r2.dev`。它独立于其他预算守护，不修改配置之外的桶、Worker、DNS 或对象。守护直接使用 R2 账户 API，无需 zone ID。

守护包含账期验证、有限重试、持久状态和暂停后自检；不包含邮件或其他消息发送。运行状态保存在独立 Durable Object，并输出到 Cloudflare Worker Logs。

## 共享额度和行为

部署账户的免费额度由所有桶共享，因此操作数和对象总大小按整个账户统计。其他桶增长可能触发 Atd 停用；Atd 的资源也计入同一账户内其他守护的阈值。各守护仅关闭自己负责的公开入口。

| 项目           | 暂停阈值                  | 检查频率                 |
| -------------- | ------------------------- | ------------------------ |
| Class A 操作   | 当前 R2 账期 900,000 次   | 每分钟                   |
| Class B 操作   | 当前 R2 账期 9,000,000 次 | 每分钟                   |
| 当前对象总大小 | 9,000,000,000 字节        | 首次、手动恢复后及每小时 |

任一阈值达到即关闭全部配置的公开入口，并再次读取配置确认。关闭失败记录 `pause_failed`，后续闹钟继续尝试。守护不会删除对象、恢复公开访问或在新账期自动解除暂停。生产配置是 `MODE: enforce`；`observe` 仅记录 `would_pause`，不可当作保护已启用。

保护性停用在调用域名接口前，将触发原因、检查数据和请求时间保存为 Durable Object 中的 `pendingPause`。任一入口的写入或复核失败、运行中断后，下一轮优先继续完成停用；用量恢复正常、账期变化或监控接口冷却都不会撤销待办。只有所有配置入口均读回 `enabled: false` 才清除待办并记录 `paused`。两个桶共有四个入口，部分关闭不算停用完成；重试不会重新开放已关闭的入口。

固定暂停线保留免费额度的 10%。同一次 GraphQL 请求同时读取账期累计与最近 10 分钟操作量；若两者之和达到暂停线，记录 `class_a_runway` / `class_b_runway` 并提前停用，相当于按近期速率再预留 10 分钟。`recentOperations`、`recentWindow` 和 `projectedOperations` 记录依据。近期窗口在账期刚切换时可包含上期末尾用量，判断更保守。达到累计硬阈值优先停用；近期统计缺失、非法或被截断也不会放行。

近期预留参与故障宽限和恢复条件，跨重启保留；不能凭较低的旧累计数忽略当前增速。现有对象清单同时验证 `storage_class`，非 Standard 类型触发 `non_standard_storage`，字段缺失也停用。此检查不增加扫描频率，不删除或转换对象，无法撤销已经产生的非 Standard 存储或读取费用。

每分钟 Cron `* * * * *` 给缺失的 Durable Object 闹钟补充启动；闹钟在外部请求前保存下一次运行时间。首次部署等待 Cron 自动启用，无需公开 HTTP 路由或额外 arming 请求。`workers.dev` 和预览 URL 都关闭。Worker 更新必须保留 `v1` 迁移及已有 Durable Object 命名空间。

账期从 R2 订阅读取，不假设月初重置。已验证账期每 15 分钟刷新，已知账期结束时立即刷新；普通缓存最多复用两小时且不得跨账期，复用不更新原验证时间。缺失字段立即读取一次匹配的订阅详情，不重复读取相同的缺字段响应或额外等待。刷新失败后每 5 分钟重查一次元数据，同时每分钟查询最新操作量；本地重查时间和服务端 `Retry-After` 独立持久化，遵守更晚的时间，跳过请求不延长期限。权限错误、账期冲突、非法响应、分页不完整或未知司法辖区均触发保护性暂停。网络和限流错误最多共享两次额外请求；仅有最近完整、低于阈值 80% 的健康记录时才给最多三分钟宽限。冷启动缺少有效账期/监控证据会停用，因此首次部署前必须检查令牌权限。

订阅列表在切换时仍返回完整旧账期，也会重查同一订阅的详情，共用上述重试预算。详情仍返回完全相同的旧账期、缺少日期字段或接口暂时不可用时，仅允许同账户、同订阅且在结束前 30 分钟内验证过的记录进入最多两小时的切换窗口，已有响应不得提供冲突日期或身份。截止固定为旧账期结束加两小时，重启和成功查询不会续期。日期或身份冲突、权限错误与窗口到期均不适用。

切换窗口每分钟查询实际操作量，从旧账期起点与旧账期结束前 30 天中的较晚者开始，保守包含上期操作并覆盖结束时间之后的全部操作；不推测新账期或重置额度。范围最长 30 天加两小时，低于 [R2 Analytics 的 31 天查询上限](https://developers.cloudflare.com/r2/platform/metrics-analytics/)。`billing.period` 保留原验证账期，`billing.source: rollover`、`operationsWindow` 和 `billing_rollover` 日志标明临时查询范围；结果记为 `billing_degraded`。累计阈值、近期流量预留和存储检查仍生效，不能叠加用量故障宽限。读取有效新账期后立即恢复实际账期统计。

暂停后自检与人工重新开放后的首次检查不使用缓存回退或切换窗口，必须重新取得有效账期；新的有效账期也不能与此前验证的旧账期重叠。

暂停后每五分钟强制读取账期、用量与完整对象清单，连续三次低于各阈值的 80%（操作量包含近期流量预留）才记录 `recovery_ready`。达到三次或暂停超过 30 分钟后完整检查降至每小时，全部入口的关闭状态仍每分钟检查。恢复始终需要人工决定；`recovery_ready` 只表示检查时点满足条件。

## 凭据和部署

唯一运行 Secret 是 `CF_API_TOKEN`，使用专用 Cloudflare 账户令牌，所需权限为目标账户的 **Workers R2 Storage Write、Account Analytics Read、Billing Read**。该控制面权限可能覆盖账户所有桶，代码只对配置中的 Atd 桶写入；账户用量和存储清单需要读取其他桶。不能将 Token 放进 `VITE_*`、源代码、命令参数或日志。Wrangler 的发布认证与这个运行 Secret 是两套独立凭据。

发布和查看日志分别需要 Wrangler 的 `workers_scripts:write`、`workers_tail:read` OAuth 权限；只有旧的 `workers:write` 登录可能可以上传 Secret，却无法读取版本或部署。下列命令使用独立的 `atd-deploy` 登录配置，不切换默认登录，也不给运行 Secret 增加部署权限。已有此配置时跳过创建步骤。

在仓库根目录执行：

```bash
# 首次复制公开模板；已有本地配置时不要覆盖。
cp -n ops/r2-budget-guard/wrangler.example.jsonc ops/r2-budget-guard/wrangler.local.jsonc
chmod 600 ops/r2-budget-guard/wrangler.local.jsonc
# 编辑本地配置，将 account_id 和 vars.CF_ACCOUNT_ID 填成同一目标账户 ID。

# 首次创建部署登录配置，在 Cloudflare 授权页面确认所列权限。
pnpm --filter @atd/website exec wrangler auth create atd-deploy --scopes account:read user:read workers_scripts:write workers_tail:read

# 本地类型和打包检查，不部署。
pnpm --filter @atd/website exec wrangler types ../../tmp/atd-r2-guard-types.d.ts --config ../../ops/r2-budget-guard/wrangler.local.jsonc
pnpm exec tsc --strict --noEmit --allowJs --checkJs --skipLibCheck --module esnext --target es2024 --moduleResolution bundler --lib ES2024 ops/r2-budget-guard/*.mjs tmp/atd-r2-guard-types.d.ts
pnpm --filter @atd/website exec wrangler deploy --dry-run --config ../../ops/r2-budget-guard/wrangler.local.jsonc

# 首次在 Cloudflare 设置运行 Secret，或通过安全交互输入上传。
pnpm --filter @atd/website exec wrangler secret put CF_API_TOKEN --config ../../ops/r2-budget-guard/wrangler.local.jsonc --profile atd-deploy

# 确认 TARGETS 中两个桶及其自定义域名、运行 Secret 均已准备好，再部署。
pnpm --filter @atd/website exec wrangler deploy --config ../../ops/r2-budget-guard/wrangler.local.jsonc --profile atd-deploy
pnpm --filter @atd/website exec wrangler tail --format json --config ../../ops/r2-budget-guard/wrangler.local.jsonc --profile atd-deploy
```

首次 Secret 上传若工具询问是否创建 Worker，仅创建 `atd-r2-budget-guard`；配置完成前不要把首次短暂缺少 Secret 的部署当作健康状态。发布后确认首个 `within_limits` 或明确的暂停结果，以及后续分钟闹钟持续运行。正常运行不依赖电脑在线。部署成功不等于检查已通过。

`wrangler.local.jsonc` 受 Git 忽略，不提交账户 ID 或令牌。共享配置更新时，把模板中的行为变更同步到本地配置，并保留目标账户、`v1` 迁移及已有 Durable Object 绑定。模板只包含占位值，不能直接用于生产部署。

新建或修改 Cron 触发器[最多需要 15 分钟传播](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。首次部署可保持日志连接等待自动启动；尚无执行记录时不要据此重复部署或判断守护已健康运行。

## 资产健康检查与恢复

预算守护不轮询业务资产，避免网站发布或缓存错误引发预算停用。PNG、MP4 的交付检查复用网站清单校验命令：

```bash
pnpm --filter @atd/website assets:check --base https://assets.atd.best --full
```

该命令需要当前网站构建产物，核对每个清单对象的大小、SHA-256、Content-Type、一年 immutable 缓存和跨域响应，并核对每个 MP4 的 206 Range 字节。详见 [网站发布说明](../../apps/website/README.md)。暂停期间不要用 CDN 检查失败推断对象丢失。安装包的发布与交付校验见 [下载镜像说明](../release-downloads/README.md)。仅手动关闭一个域名时，守护继续监控其他仍开放的入口。

恢复时先在 [Cloudflare 控制台](https://dash.cloudflare.com/) 选择部署账户 → Workers → `atd-r2-budget-guard` → Logs，复核暂停原因、用量和 `recovery_ready`。解决根因且确认额度后，分别在 R2 → `atd-assets` / `atd-releases` → Settings → Custom Domains 手动启用 `assets.atd.best` / `downloads.atd.best`，保持两个桶的 `r2.dev` 关闭。然后核实新的 `within_limits`，运行资产健康检查。需要紧急停用时在同一位置 Disable domain，无需删除桶或域名连接。

## 2026-10-10 持续停用修复

旧实现只保存 `pause_failed` 结果，没有保存未完成的停用决定；接口恢复后可能直接回到正常监控，遗漏本应完成的停用。此次同步加入上述 `pendingPause`，在调用四个入口的停用接口前持久化，后续闹钟优先完成原停用决定。

严格类型检查、修改文件的 Oxlint 和格式检查、Wrangler 打包预检均通过。复用已有的停用失败回归用例，单目标配置下通过 4 项，双目标配置下通过 3 项，覆盖中断后恢复、写入成功但复核失败、持久化失败及观察模式。

经授权于新加坡时间 12:16:45 发布。生产代码与已验证的本地打包文件逐字节一致，保留独立 Durable Object、运行 Secret、两个目标桶、原阈值、`MODE: enforce` 和每分钟 Cron。部署后控制面核实两个自定义域名均启用且证书正常，两个 `r2.dev` 均关闭。Worker 的公开 URL 与预览 URL 保持关闭。

12:17:51、12:18:51 连续两轮新版本的真实 Durable Object 闹钟均记录 `within_limits`、`outcome: ok`，没有异常。第二轮账户累计 A 类 2,177 次、B 类 5,157 次，账期仍为 9 月 14 日至 10 月 14 日；分钟检查沿用每小时存储清单。正常检查会读取两个桶的四个入口，此次未人为触发生产停用，故障恢复分支由前述回归用例验证。

## 2026-10-14 账期切换修复与恢复

本次同步修复订阅接口在账期结束后暂时返回旧日期所导致的立即停用，加入上文所述详情重查与最多两小时的保守切换窗口。09:30（UTC+8）的生产完整自检已从 API 取得 10 月 14 日至 11 月 14 日的新账期，账户 A/B 类操作量为零，存储清单为 717,707,778 字节。

严格类型检查、修改文件的 Oxlint 与格式检查、Wrangler 打包预检通过。复用已有账期与恢复回归用例，在单目标和双目标配置下各通过 27 项，覆盖过期列表、两小时硬截止、跨重启状态、实时阈值、31 天查询范围及人工重新开放后的强制检查。

经授权于 09:52 发布修复，生产代码与已验证的本地打包文件逐字节一致；保留原 Durable Object、Secret、两个目标桶、阈值、`MODE: enforce`、兼容日期和每分钟 Cron。09:54 恢复两个自定义域名，对应 `r2.dev`、Worker 公开 URL 与预览 URL 保持关闭。09:55、09:56 两轮新版本闹钟均记录 `within_limits`、`outcome: ok`，无异常。首轮重新读取有效账期与完整对象清单；第二轮账户 A 类 12 次、B 类 22 次，存储恢复每小时检查。

网站全部 58 个资源的本地哈希、CDN 状态、大小、类型、缓存、CORS 和视频分段检查通过；抽样图片的缓存 MISS 请求返回内容也与本地哈希一致。`appcast.xml`、`latest.json`、v0.8.1 版本包与固定 arm64 下载链接均恢复，大小、缓存和 206 尾段的 DMG 标识通过检查。核实 GitHub 最新正式版 v0.8.1 只有 arm64 产物，R2 尚无 x64 包或更新源；因此 `appcast-x64.xml` 的 404 属于尚未发布 Intel 产物的状态，此次未新增发布产物。

### 首次账期修复的费用风险复审（优化前）

本次改动没有重置额度、降低停用阈值或自动开放入口。切换查询起点不晚于已验证的旧账期结束时间，覆盖全部边界后操作，并保守包含部分上期操作；这是查询范围的保证，分析数据仍可能[采样](https://developers.cloudflare.com/analytics/graphql-api/sampling/)。两小时期限不续期，权限或用量查询失败、实际用量触线与待完成的停用均不会借切换窗口放行。

额外开销是旧账期响应后的订阅元数据重试、等待与日志，每轮仍共享最多两次额外请求；闹钟和清单扫描频率未提高，也没有新增对象下载。正常每分钟执行一次时，一个守护的两小时窗口约 120 轮、最多 240 次额外重试；这是正常调度估算，不包括平台重投。资源恢复后重新产生正常读取用量。

仍不能保证零费用：流量突发、统计与控制面延迟可能越过预留余量；[R2 免费额度](https://developers.cloudflare.com/r2/pricing/)仅覆盖 Standard，当前对象总大小不能代替 GB-month 的每日峰值统计或计入未完成分段上传。关闭公开入口也不停止存储、私有 API 或其他服务计费。[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) 和 [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing)有独立套餐额度，应合并账户其他应用核对。本次未升级套餐或启用新的付费产品。

## 2026-10-14 费用保护优化

将固定停用线降至免费额度的 90%，用同一次请求取得最近 10 分钟操作量并预留同等用量，且将预留纳入故障宽限与恢复判断。普通账期缓存最长两小时，账期结束后的切换窗口仍固定两小时；新增每五分钟重查元数据的持久冷却，缺字段只立即复核一次详情。人工恢复后的首次账期验证失败不能沿用缓存。每小时清单增加存储类型校验。

费用复审：未提高闹钟、Cron 或清单扫描频率，未增加正常每轮的 GraphQL 请求次数，未升级套餐或增加付费产品；新增近期统计会增加单次查询处理量及日志内容。持续缺字段时，从每轮重复读取及退避等待改为每五分钟读取列表与一次详情，成功响应缺字段本身不再等待。扩大缓存只复用账期日期，累计及近期用量仍每分钟检查，硬到期、权限错误、真实阈值和待完成停用不会被跳过。

发布前实查三个桶共 171 个对象、717,707,778 字节，全部为 Standard。10:39–10:40 两个新版守护均记录 `within_limits` / `outcome: ok`，近期预留已出现在实际结果中；10:40 均重新从 API 验证有效账期。该轮账户 A 类 24 次、B 类 74 次，最近 10 分钟为 A 类 4 次、B 类 1 次。三个自定义域名保持开放，三个 `r2.dev` 保持关闭；网站抽样资源缓存 MISS 返回的哈希正确，Atd 更新源返回 200，arm64 安装包分段返回 206 且 DMG 尾部有效。

本轮仍不能保证零费用：10% 固定余量和近期流量预留缓解突发及统计延迟，但不能阻止瞬时超额；非 Standard 检查仅能停止后续公开读取，不能撤销存储费用。未完成分段上传、GB-month、私有 API 调用、其他桶或其他产品的费用仍需按前述保护范围判断。

复用已有守护回归中的 36 项账期、恢复、流量预留与存储类型检查，单目标和双目标配置均通过；严格类型检查、Oxlint、修改文件格式和 Wrangler 打包预检通过。线上打包文件与预检文件逐字节一致；除三个阈值外，Durable Object、Secret 等绑定、运行兼容性、可观测性与迁移标记均保持一致，每分钟 Cron 保留。此次仅修改独立守护，未构建或启动原生应用。

## 限制

这是提前停用措施，不是账单硬上限。Cloudflare 统计可能延迟/采样，调度和域名传播也有延迟；Worker 免费额度耗尽、服务故障或令牌被撤销时无法保证成功关闭。缓存中的内容可能继续可读。公开访问关闭不影响存储计费、私有 API 读取、其他桶或 Vercel。

存储检查采用当前对象总大小，不等于 GB-month 账单，也不包含未完成的分段上传。默认司法辖区之外的桶、超过 20 页对象清单或不完整分页会触发保护性暂停。没有配置邮件/短信通知；应在控制台检查 Logs 中的 `monitor_degraded`、`billing_degraded`、`paused`、`pause_failed` 和 `recovery_ready`。
