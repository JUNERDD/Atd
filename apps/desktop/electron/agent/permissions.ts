import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  grantKey,
  tierAllows,
  type ConfirmationRequest,
  type GrantLocation,
  type GrantScope,
  type PermissionAnswer,
  type PermissionOutcome,
  type PermissionRecord,
} from '../../src/client/agent/permission-schema';
import { taskPermissionTier, type AgentTask } from '../../src/client/agent/task-schema';
import { errorMessage } from '../../src/client/agent/validation';

export interface PermissionDecision {
  taskId: string;
  runId: string;
  toolCallId: string;
  scope: GrantScope;
  title: string;
  detail: string;
}

export interface PermissionGateHost {
  task: (id: string) => AgentTask;
  ask: (request: ConfirmationRequest) => Promise<Extract<PermissionAnswer, { decision: unknown }>>;
  record: (taskId: string, record: PermissionRecord) => Promise<void>;
  failed?: (taskId: string, text: string) => void;
}

/** Canonical target vs the task output folder: inside the folder or strictly outside it. */
export function locationOf(target: string, taskFolder: string): GrantLocation {
  const prefix = taskFolder.endsWith(path.sep) ? taskFolder : taskFolder + path.sep;
  return target === taskFolder || target.startsWith(prefix) ? 'inside' : 'outside';
}

/**
 * Per-task approval gate. Session grants live in memory for this process; `app-permission`
 * records persist them so a later `transcript` snapshot can `seed` the set again.
 */
export class PermissionGate {
  readonly grants = new Map<string, Set<string>>();

  constructor(private readonly host: PermissionGateHost) {}

  seed(taskId: string, scopes: GrantScope[]) {
    const keys = this.grants.get(taskId) ?? new Set<string>();
    for (const scope of scopes) keys.add(grantKey(scope));
    this.grants.set(taskId, keys);
  }

  forget(taskId: string) {
    this.grants.delete(taskId);
  }

  async decide(input: PermissionDecision): Promise<PermissionOutcome> {
    const tier = taskPermissionTier(this.host.task(input.taskId));
    let outcome: PermissionOutcome;
    if (tierAllows(tier, input.scope)) outcome = 'tier';
    else if (this.grants.get(input.taskId)?.has(grantKey(input.scope))) outcome = 'grant';
    else {
      const answer = await this.host.ask({
        kind: 'confirmation',
        id: randomUUID(),
        taskId: input.taskId,
        runId: input.runId,
        toolCallId: input.toolCallId,
        scope: input.scope,
        title: input.title,
        detail: input.detail,
      });
      outcome = answer.decision;
      if (outcome === 'session') this.seed(input.taskId, [input.scope]);
    }
    try {
      await this.host.record(input.taskId, {
        toolCallId: input.toolCallId,
        runId: input.runId,
        scope: input.scope,
        outcome,
        at: Date.now(),
      });
    } catch (error) {
      this.host.failed?.(
        input.taskId,
        `Could not record the permission decision. ${errorMessage(error)}`,
      );
    }
    return outcome;
  }
}
