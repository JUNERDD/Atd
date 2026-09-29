import { randomUUID } from 'node:crypto';
import type { AgentTask, PermissionRequest, RunStatus } from '@ai/agent-contracts';

/** A ledger task whose latest run has `status` (no run when undefined). */
export function task(
  status: RunStatus | undefined,
  options: { id?: string; rootTaskId?: string } = {},
): AgentTask {
  const now = new Date().toISOString();
  return {
    id: options.id ?? randomUUID(),
    title: 'Fixture task',
    createdAt: now,
    updatedAt: now,
    sessionFile: null,
    runs:
      status === undefined
        ? []
        : [
            {
              id: randomUUID(),
              operationId: randomUUID(),
              createdAt: now,
              status,
              error: '',
              snapshot: {
                input: {
                  text: 'Fixture',
                  source: 'manual',
                  capturedAt: now,
                  selection: '',
                  clipboard: '',
                  files: [],
                  arguments: {},
                },
                instructions: '',
                model: {
                  connectionId: 'fixture',
                  modelId: 'fixture',
                  provider: 'fixture',
                  baseUrl: '',
                },
                tools: [],
                memory: false,
              },
            },
          ],
    rootTaskId: options.rootTaskId ?? null,
    parentExecutionId: null,
  };
}

/** A pending `input` request raised by the task's latest run. */
export function inputRequest(owner: AgentTask): PermissionRequest {
  return {
    id: randomUUID(),
    revision: 1,
    taskId: owner.id,
    runId: owner.runs.at(-1)?.id ?? randomUUID(),
    executionId: 'root:fixture',
    toolCallId: 'fixture',
    kind: 'input',
    title: 'Fixture question',
    options: [],
    createdAt: new Date().toISOString(),
  };
}
