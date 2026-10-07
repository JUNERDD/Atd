# Atd R2 预算守护

`atd-r2-budget-guard` 只管理 `atd-assets` 的 `assets.atd.best` 和该桶的 `r2.dev` 公开入口。它独立于 `other-r2-budget-guard`，不修改其他桶、Worker、DNS 或对象。守护直接使用 R2 账户 API，无需 zone ID。

代码按已审读的 `private-reference/r2-budget-guard` 实现适配，保留账期验证、有限重试、持久状态和暂停后自检；不包含邮件或其他消息发送。运行状态保存在独立 Durable Object，并输出到 Cloudflare Worker Logs。

## 共享额度和行为

Cloudflare 账户 `YOUR_CLOUDFLARE_ACCOUNT_ID` 的免费额度由所有桶共享，因此操作数和对象总大小按整个账户统计。其他桶增长可能触发 Atd 停用；Atd 的资源也计入同一账户内其他守护的阈值。两个守护各自仅关闭自己的公开入口。

| 项目           | 暂停阈值                  | 检查频率                 |
| -------------- | ------------------------- | ------------------------ |
| Class A 操作   | 当前 R2 账期 950,000 次   | 每分钟                   |
| Class B 操作   | 当前 R2 账期 9,500,000 次 | 每分钟                   |
| 当前对象总大小 | 9,500,000,000 字节        | 首次、手动恢复后及每小时 |

任一阈值达到即关闭两个公开入口，并再次读取配置确认。关闭失败记录 `pause_failed`，后续闹钟继续尝试。守护不会删除对象、恢复公开访问或在新账期自动解除暂停。生产配置是 `MODE: enforce`；`observe` 仅记录 `would_pause`，不可当作保护已启用。

每分钟 Cron `* * * * *` 给缺失的 Durable Object 闹钟补充启动；闹钟在外部请求前保存下一次运行时间。首次部署等待 Cron 自动启用，无需公开 HTTP 路由或额外 arming 请求。`workers.dev` 和预览 URL 都关闭。Worker 更新必须保留 `v1` 迁移及已有 Durable Object 命名空间。

账期从 R2 订阅读取，不假设月初重置。已验证账期每 15 分钟刷新，最多复用 30 分钟且不得跨账期；缺失字段会尝试读取匹配的订阅详情。权限错误、账期冲突、非法响应、分页不完整或未知司法辖区均触发保护性暂停。网络和限流错误最多共享两次额外请求；仅有最近完整、低于阈值 80% 的健康记录时才给最多三分钟宽限。冷启动缺少有效账期/监控证据会停用，因此首次部署前必须检查令牌权限。

暂停后每五分钟强制读取账期、用量与完整对象清单，连续三次低于各阈值的 80% 才记录 `recovery_ready`。达到三次或暂停超过 30 分钟后完整检查降至每小时，两个入口的关闭状态仍每分钟检查。恢复始终需要人工决定；`recovery_ready` 只表示检查时点满足条件。

## 凭据和部署

唯一运行 Secret 是 `CF_API_TOKEN`，使用专用 Cloudflare 账户令牌，所需权限为目标账户的 **Workers R2 Storage Write、Account Analytics Read、Billing Read**。该控制面权限可能覆盖账户所有桶，代码只对配置中的 Atd 桶写入；账户用量和存储清单需要读取其他桶。不能将 Token 放进 `VITE_*`、源代码、命令参数或日志。Wrangler 的发布认证与这个运行 Secret 是两套独立凭据。

在仓库根目录执行：

```bash
# 本地类型和打包检查，不部署。
pnpm --filter @atd/website exec wrangler types ../../tmp/atd-r2-guard-types.d.ts --config ../../ops/r2-budget-guard/wrangler.jsonc
pnpm exec tsc --strict --noEmit --allowJs --checkJs --skipLibCheck --module esnext --target es2024 --moduleResolution bundler --lib ES2024 ops/r2-budget-guard/*.mjs tmp/atd-r2-guard-types.d.ts
pnpm --filter @atd/website exec wrangler deploy --dry-run --config ../../ops/r2-budget-guard/wrangler.jsonc

# 首次在 Cloudflare 设置运行 Secret，或通过安全交互输入上传。
pnpm --filter @atd/website exec wrangler secret put CF_API_TOKEN --config ../../ops/r2-budget-guard/wrangler.jsonc

# 确认 atd-assets、assets.atd.best 和 Secret 均已准备好，再部署。
pnpm --filter @atd/website exec wrangler deploy --config ../../ops/r2-budget-guard/wrangler.jsonc
pnpm --filter @atd/website exec wrangler tail --format json --config ../../ops/r2-budget-guard/wrangler.jsonc
```

首次 Secret 上传若工具询问是否创建 Worker，仅创建 `atd-r2-budget-guard`；配置完成前不要把首次短暂缺少 Secret 的部署当作健康状态。发布后确认首个 `within_limits` 或明确的暂停结果，以及后续分钟闹钟持续运行。控制台的 Cron Trigger 测试可补充启动，正常运行不依赖电脑在线。部署成功不等于检查已通过。

## 资产健康检查与恢复

预算守护不轮询业务资产，避免网站发布或缓存错误引发预算停用。PNG、MP4 的交付检查复用网站清单校验命令：

```bash
pnpm --filter @atd/website assets:check --base https://assets.atd.best --full
```

该命令需要当前网站构建产物，核对每个清单对象的大小、SHA-256、Content-Type、一年 immutable 缓存和跨域响应，并核对每个 MP4 的 206 Range 字节。详见 [网站发布说明](../../apps/website/README.md)。暂停期间不要用 CDN 检查失败推断对象丢失。

恢复时先在 [Worker Logs](https://dash.cloudflare.com/YOUR_CLOUDFLARE_ACCOUNT_ID/workers/services/view/atd-r2-budget-guard/production/settings) 复核暂停原因、用量和 `recovery_ready`。解决根因且确认额度后，在 R2 → `atd-assets` → Settings → Custom Domains 手动启用 `assets.atd.best`，保持 `r2.dev` 关闭。然后核实新的 `within_limits`，运行资产健康检查。需要紧急停用时在同一位置 Disable domain，无需删除桶或域名连接。

## 限制

这是提前停用措施，不是账单硬上限。Cloudflare 统计可能延迟/采样，调度和域名传播也有延迟；Worker 免费额度耗尽、服务故障或令牌被撤销时无法保证成功关闭。缓存中的内容可能继续可读。公开访问关闭不影响存储计费、私有 API 读取、其他桶或 Vercel。

存储检查采用当前对象总大小，不等于 GB-month 账单，也不包含未完成的分段上传。默认司法辖区之外的桶、超过 20 页对象清单或不完整分页会触发保护性暂停。没有配置邮件/短信通知；应在控制台检查 Logs 中的 `monitor_degraded`、`billing_degraded`、`paused`、`pause_failed` 和 `recovery_ready`。
