import { stat } from 'node:fs/promises';
import { rootExecutionId, type RunStatus } from '@atd/agent-contracts';
import type { CapabilityRegistry } from './capabilities.js';
import type { ConfirmStore } from './confirms.js';
import type { EventLog } from './event-log.js';
import { Ledger } from './ledger.js';
import type { Logger } from './logging.js';

export interface RecoveryReport {
  requeued: string[];
  interrupted: string[];
  unknown: string[];
  waitingKept: string[];
  confirms: { kept: number; dropped: number };
  capabilities: { kept: number; dropped: number };
}

/**
 * Crash/restart recovery from the ledger and Pi JSONL. Queued runs that never
 * started stay queued; live runs become interrupted (or unknown when even the
 * session file cannot confirm what happened). Nothing is auto-replayed.
 */
export async function recoverService(options: {
  ledger: Ledger;
  events: EventLog;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  log: Logger;
}): Promise<RecoveryReport> {
  const { ledger, events, confirms, capabilities } = options;
  const report: RecoveryReport = {
    requeued: [],
    interrupted: [],
    unknown: [],
    waitingKept: [],
    confirms: { kept: 0, dropped: 0 },
    capabilities: { kept: 0, dropped: 0 },
  };
  report.confirms = await confirms.recover();
  report.capabilities = await capabilities.recover();
  const waitingRuns = new Set<string>();
  for (const request of confirms.pending()) waitingRuns.add(`${request.taskId}:${request.runId}`);

  for (const task of ledger.data.tasks) {
    for (const run of task.runs) {
      switch (run.status) {
        case 'queued':
          // Never started: safe to dispatch on boot, not a replay of work.
          report.requeued.push(run.id);
          break;
        case 'awaiting_input':
        case 'awaiting_confirmation':
          if (waitingRuns.has(`${task.id}:${run.id}`)) {
            report.waitingKept.push(run.id);
          } else {
            await mark(
              ledger,
              events,
              task.id,
              run.id,
              'interrupted',
              'The pending request did not survive the restart.',
            );
            report.interrupted.push(run.id);
          }
          break;
        case 'running':
        case 'stopping': {
          const known = task.sessionFile ? await sessionExists(task.sessionFile) : false;
          if (task.sessionFile && known) {
            await mark(
              ledger,
              events,
              task.id,
              run.id,
              'interrupted',
              'The service restarted mid-run.',
            );
            report.interrupted.push(run.id);
          } else {
            await mark(
              ledger,
              events,
              task.id,
              run.id,
              'unknown',
              'The run outcome could not be established after restart.',
            );
            report.unknown.push(run.id);
          }
          break;
        }
        case 'cancelled':
        case 'completed':
        case 'failed':
        case 'interrupted':
        case 'stopped':
        case 'unknown':
          // Settled before the restart: nothing to recover.
          break;
      }
    }
  }
  return report;
}

async function sessionExists(sessionFile: string): Promise<boolean> {
  try {
    return (await stat(sessionFile)).isFile();
  } catch {
    return false;
  }
}

async function mark(
  ledger: Ledger,
  events: EventLog,
  taskId: string,
  runId: string,
  status: RunStatus,
  error: string,
): Promise<void> {
  await ledger.change((data) => {
    const task = data.tasks.find((item) => item.id === taskId);
    const run = task?.runs.find((item) => item.id === runId);
    if (!task || !run) return;
    run.status = status;
    run.error = error;
    task.updatedAt = new Date().toISOString();
  });
  events.publish({
    taskId,
    runId,
    executionId: rootExecutionId(runId),
    type: 'run.status',
    data: { status, error },
  });
}
