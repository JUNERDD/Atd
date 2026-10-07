// @ts-check
import { DurableObject } from 'cloudflare:workers';
import { PauseFailedError, runGuard } from './worker.mjs';
import { INVENTORY_INTERVAL } from './health.mjs';

/** One persistent scheduler for this guard and R2 account, independent of visitor traffic.
 * @extends {DurableObject<Env>}
 */
export class BudgetAlarm extends DurableObject {
  async ensureAlarm() {
    let nextAlarmAt = await this.ctx.storage.getAlarm();
    if (nextAlarmAt === null) {
      nextAlarmAt = Date.now() + 1000;
      await this.ctx.storage.setAlarm(nextAlarmAt);
    }
    return { event: 'alarm_armed', nextAlarmAt };
  }

  async inspect() {
    return {
      nextAlarmAt: await this.ctx.storage.getAlarm(),
      lastResult: (await this.ctx.storage.get('lastResult')) ?? null,
      monitorState: (await this.ctx.storage.get('monitorState')) ?? null,
    };
  }

  async alarm() {
    const now = new Date();
    // Persist the next wake-up before external I/O, so a failed check cannot
    // quietly stop the recurring scheduler. R2 disable operations are idempotent.
    await this.ctx.storage.setAlarm(+now + 60000);
    const monitorState = /** @type {import('./health.mjs').MonitorState} */ (
      (await this.ctx.storage.get('monitorState')) ?? {}
    );
    // Old deployments have no health snapshot: require a complete first check.
    const lastInventory = monitorState.lastHealthy?.storageCheckedAt;
    const checkStorage = lastInventory === undefined || +now - lastInventory >= INVENTORY_INTERVAL;
    /** @type {Awaited<ReturnType<typeof runGuard>> | {event: string, checkedAt: string, error: string}} */
    let result;
    let guardFailure;
    try {
      result = await runGuard(this.env, { now, checkStorage, monitorState });
    } catch (error) {
      guardFailure = error instanceof Error ? error : new Error('Unknown guard failure');
      result =
        error instanceof PauseFailedError
          ? error.report
          : {
              event: 'alarm_failed',
              checkedAt: now.toISOString(),
              error: error instanceof Error ? error.message : 'Unknown error',
            };
    }
    await this.ctx.storage.put({
      lastResult: result,
      monitorState,
      ...(checkStorage && result.event === 'within_limits' ? { lastInventory: +now } : {}),
    });
    if (guardFailure) throw guardFailure;
  }
}

export default {
  /** Cron is only a backup that arms a missing alarm; checks run in the object.
   * @param {ScheduledController} controller @param {Env} env @param {ExecutionContext} ctx
   */
  scheduled(controller, env, ctx) {
    ctx.waitUntil(env.GUARD_ALARM.getByName(env.CF_ACCOUNT_ID).ensureAlarm());
  },
};
