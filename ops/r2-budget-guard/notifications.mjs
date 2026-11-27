// @ts-check

/** @typedef {{event: string, checkedAt: string, mode?: string, reasons?: string[], usage?: object, error?: string, graceUntil?: string, recoveryChecks?: number}} GuardReport */
/** @typedef {{id: string, kind: string, report: GuardReport, attempts: number, nextAttemptAt: number, deliveredAt?: number}} Notice */
/** @typedef {{recipient: string, phase: string, outbox: Record<string, Notice>}} MailState */

const RETRY_MIN = 5 * 60000;
const RETRY_MAX = 60 * 60000;

/** @param {GuardReport} report @param {string} previous */
function phaseFor(report, previous) {
  switch (report.event) {
    case 'within_limits':
      return 'healthy';
    case 'monitor_degraded':
    case 'billing_degraded':
      return 'monitor_degraded';
    case 'recovery_ready':
      return 'recovery_ready';
    case 'paused_check_failed':
    case 'paused_check_passed':
      if (previous === 'recovery_ready') return 'recovery_not_ready';
      if (['pause_failed', 'monitor_failed'].includes(previous)) return 'pause_reconfirmed';
      return ['paused', 'monitor_paused', 'recovery_not_ready', 'pause_reconfirmed'].includes(
        previous,
      )
        ? previous
        : 'monitor_paused';
    case 'paused':
      return report.reasons?.includes('monitor_error') ? 'monitor_paused' : 'paused';
    case 'remains_paused':
    case 'pause_reconfirmed':
      // Preserve the original cause while the domains remain disabled.
      if (
        [
          'paused',
          'monitor_paused',
          'recovery_ready',
          'recovery_not_ready',
          'pause_reconfirmed',
        ].includes(previous)
      )
        return previous;
      if (
        report.event === 'pause_reconfirmed' ||
        ['pause_failed', 'monitor_failed'].includes(previous)
      )
        return 'pause_reconfirmed';
      return 'paused';
    case 'pause_failed':
      return 'pause_failed';
    case 'alarm_failed':
      return 'monitor_failed';
    default:
      return previous;
  }
}

/** @param {Env} env @param {Notice} notice @returns {EmailMessageBuilder} */
export function buildEmail(env, notice) {
  const { kind, report } = notice;
  const labels = /** @type {Record<string, string>} */ ({
    setup: '邮件通知配置验证',
    paused: 'R2 资源已暂停',
    monitor_paused: '监控异常，R2 资源已暂停',
    pause_failed: '紧急：无法确认 R2 资源已暂停',
    pause_reconfirmed: '已重新核实 R2 资源仍处于暂停状态',
    monitor_failed: '紧急：R2 守护运行异常',
    monitor_degraded: '监控暂时异常，资源暂未停用',
    monitor_recovered: '监控已恢复，资源继续开放',
    recovery_ready: 'R2 检查已通过，等待手动恢复',
    recovery_not_ready: 'R2 恢复条件待重新确认，资源继续暂停',
  });
  const reasonLabels = /** @type {Record<string, string>} */ ({
    class_a_limit: 'A 类操作达到配置的暂停线',
    class_b_limit: 'B 类操作达到配置的暂停线',
    storage_limit: '当前存储容量达到配置的暂停线',
    class_a_runway: 'A 类操作加近期十分钟用量已达到暂停线',
    class_b_runway: 'B 类操作加近期十分钟用量已达到暂停线',
    non_standard_storage: '检测到不适用免费额度的存储类型',
    monitor_error: '用量查询失败或统计异常，执行保护性暂停',
    public_entry_reopened: '检测到公开开发入口被重新开放，已再次关闭',
    insufficient_recovery_headroom: '用量尚未低于暂停阈值的 80%，暂不建议恢复',
  });
  const checkedAt = new Date(report.checkedAt).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  const domains = env.TARGETS.map((target) => target.domain).join('、');
  const buckets = env.TARGETS.map((target) => target.bucket).join('、');
  const lines = [
    labels[kind],
    '',
    `检查时间：${checkedAt}（北京时间）`,
    `资源域名：${domains}`,
    `存储桶：${buckets}`,
    '',
  ];
  if (kind === 'setup') {
    lines.push(
      '这是一封配置验证邮件，验证本身没有暂停资源。',
      `本次守护检查结果：${report.event === 'within_limits' ? '额度正常，继续访问' : report.event}`,
      '发生暂停成功、暂停失败或监控异常时，将通过此邮箱通知你。',
    );
  } else if (kind === 'monitor_degraded') {
    lines.push(
      '监控暂时异常，守护程序本轮未执行停用。',
      '账期缺失时仅在已验证账期的有效期限内复用；切换时短暂返回旧账期则使用包含上期用量的保守窗口，仍查询最新用量。',
      '账期切换窗口最多两小时，不推测新账期或重置额度；用量查询故障使用原有短暂宽限。',
      '达到暂停阈值、缓存或宽限到期、权限错误或数据冲突时，将执行保护性暂停。',
    );
  } else if (kind === 'monitor_recovered') {
    lines.push('本轮监控检查已恢复正常，所有配置的资源域名处于启用状态。');
  } else if (kind === 'pause_reconfirmed') {
    lines.push(
      '本次复核已确认所有配置的自定义资源域名和 r2.dev 入口均已关闭。恢复条件以完整用量自检结果为准。',
    );
  } else if (kind === 'recovery_ready' || kind === 'recovery_not_ready') {
    lines.push('已核实所有配置的自定义资源域名和 r2.dev 公开入口均已关闭，程序没有自动开放资源。');
    if (kind === 'recovery_ready') {
      lines.push(
        '同一账期内连续三次完整检查通过，均重新读取了账期、操作量和存储清单，用量低于暂停阈值的 80%。',
        '具备手动恢复的检查条件。请复核当前用量后，在各 R2 桶的 Settings → Custom Domains 启用资源域名，并保持 r2.dev 关闭。',
      );
    } else {
      lines.push('此前的恢复条件已失效或检查间隔过长，需重新累计三次连续完整检查。');
    }
  } else if (kind === 'paused' || kind === 'monitor_paused') {
    lines.push(
      '已核实所有配置的自定义资源域名和 r2.dev 公开入口均已关闭。',
      '已缓存的文件可能继续显示；新的 R2 公开回源访问已停用。',
      '资源不会自动恢复，包括进入下个计费周期时。',
      '恢复前请先处理异常流量或监控问题，再进入各 R2 桶的 Settings → Custom Domains 手动启用域名，并保持 r2.dev 关闭。',
    );
  } else {
    lines.push(
      '尚未能确认所有配置的公开入口均已关闭，不能将这封邮件视为停用成功。',
      '请立即检查 Cloudflare 中的资源访问状态，必要时手动关闭自定义域名和 r2.dev。',
      '守护程序会继续尝试检查；请同时检查令牌权限和 Cloudflare 服务状态。',
    );
  }
  if (report.reasons?.length)
    lines.push('', `触发原因：${report.reasons.map((r) => reasonLabels[r] ?? r).join('；')}`);
  if (report.graceUntil) lines.push('', `本次短暂宽限最晚结束于：${report.graceUntil}`);
  if (report.usage) lines.push('', '本次检查数据：', JSON.stringify(report.usage, null, 2));
  if (report.error) lines.push('', `错误：${report.error.slice(0, 500)}`);
  lines.push(
    '',
    `守护日志：https://dash.cloudflare.com/${env.CF_ACCOUNT_ID}/workers/services/view/atd-r2-budget-guard/production/settings`,
    '',
    '此邮件记录上述检查时间的结果；若邮件延迟送达，请以控制台当前状态为准。',
    '本邮件由资源守护程序自动发送，请勿回复。',
  );
  return {
    from: { name: 'atd.best 资源守护', email: env.NOTIFY_FROM },
    to: env.NOTIFY_TO,
    subject: `[atd.best] ${labels[kind]}`,
    text: lines.join('\n'),
    headers: { 'X-R2-Guard-Notification-ID': notice.id },
  };
}

/**
 * One durable outbox entry per event kind bounds storage during a mail outage.
 * Repeated states do not create mail; a later state change may replace an older
 * pending notice of the same kind with the latest result.
 * @param {Pick<DurableObjectStorage, 'get'|'put'>} storage
 * @param {Env} env
 * @param {GuardReport} report
 * @param {{now?: number, log?: (record: object) => void}} [options]
 */
export async function processNotifications(storage, env, report, options = {}) {
  if (env.MODE !== 'enforce') return;
  const now = options.now ?? Date.now();
  const log = options.log ?? ((record) => console.log(JSON.stringify(record)));
  const saved = /** @type {MailState | undefined} */ (await storage.get('notifications'));
  const state =
    saved?.recipient === env.NOTIFY_TO
      ? saved
      : {
          recipient: env.NOTIFY_TO,
          phase: 'initial',
          outbox: /** @type {Record<string, Notice>} */ ({}),
        };
  const phase = phaseFor(report, state.phase);
  let changed = false;
  /** @param {string} kind */
  const queue = (kind) => {
    state.outbox[kind] = { id: crypto.randomUUID(), kind, report, attempts: 0, nextAttemptAt: now };
    changed = true;
  };
  if (phase !== state.phase) {
    if (phase !== 'healthy' && phase !== 'initial') queue(phase);
    if (phase === 'healthy' && state.phase === 'monitor_degraded') queue('monitor_recovered');
    // Actionable notices must not arrive after their conditions have expired.
    for (const kind of [
      'recovery_ready',
      'recovery_not_ready',
      'monitor_degraded',
      'monitor_recovered',
      'pause_reconfirmed',
    ]) {
      const applicable = kind === 'monitor_recovered' ? phase === 'healthy' : phase === kind;
      if (!applicable && state.outbox[kind]?.deliveredAt === undefined) delete state.outbox[kind];
    }
    state.phase = phase;
    changed = true;
  }
  if (
    phase === 'recovery_ready' &&
    report.event === 'recovery_ready' &&
    state.outbox.recovery_ready?.deliveredAt === undefined &&
    state.outbox.recovery_ready
  ) {
    // Keep a delayed actionable notice tied to the latest complete probe.
    state.outbox.recovery_ready.report = report;
    changed = true;
  }
  if (!state.outbox.setup) queue('setup');
  // Commit the notification before sending so restarts retain pending work.
  if (changed) await storage.put('notifications', state);
  const due = Object.values(state.outbox)
    .filter((notice) => notice.deliveredAt === undefined && notice.nextAttemptAt <= now)
    .sort((a, b) => Number(a.kind === 'setup') - Number(b.kind === 'setup'))
    .slice(0, 2);
  for (const notice of due) {
    notice.attempts += 1;
    notice.nextAttemptAt =
      now + Math.min(RETRY_MAX, RETRY_MIN * 2 ** Math.min(notice.attempts - 1, 4));
    // A crash during delivery backs off too. Email delivery is at-least-once;
    // a crash after provider acceptance can still cause a duplicate on retry.
    await storage.put('notifications', state);
    try {
      const sent = await env.GUARD_EMAIL.send(buildEmail(env, notice));
      notice.deliveredAt = Date.now();
      log({
        event: 'notification_sent',
        kind: notice.kind,
        notificationId: notice.id,
        messageId: sent.messageId,
      });
    } catch (error) {
      log({
        event: 'notification_failed',
        kind: notice.kind,
        notificationId: notice.id,
        attempts: notice.attempts,
        retryAt: new Date(notice.nextAttemptAt).toISOString(),
        error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown mail error',
      });
    }
    await storage.put('notifications', state);
  }
}
