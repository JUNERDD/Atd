import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  AgentTask,
  AutomationDraft,
  RunStatus,
  ServiceBlock,
  SubmitTaskRequest,
  SubmitTaskResponse,
} from '@atd/agent-contracts';
import { createAutomation } from '../dist/automations/edits.js';
import type { AutomationRuns } from '../dist/automations/engine-deps.js';
import type { FolderScanner } from '../dist/automations/folder-watch.js';
import type { LaunchCommandRequest } from '../dist/commands/launch.js';
import { AutomationService } from '../dist/automations/service.js';
import { EventLog } from '../dist/event-log.js';
import { FolderStore } from '../dist/folders/store.js';
import { Ledger } from '../dist/ledger.js';
import { ResourceStore } from '../dist/resources.js';
import { servicePaths } from '../dist/storage.js';
import type { InternalSubmitOptions } from '../dist/tasks/submit-options.js';

/**
 * The automation engine over a real store, ledger and event log in a temporary data directory,
 * with fake task runs: a submit is accepted into the ledger as the run pipeline would accept it
 * (queued, with its origin, tier, title and trigger) but never executes. A test ends a run with
 * `finish`, and drives time with `clock.now` and `service.engine.tick`.
 */

export const quiet = { debug() {}, info() {}, warn() {}, error() {} };

export interface Submitted {
  request: SubmitTaskRequest;
  internal: InternalSubmitOptions;
  taskId: string;
  runId: string;
}

export function draft(fields: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    name: 'Morning digest',
    enabled: true,
    trigger: { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' }, timezone: 'UTC' },
    action: { kind: 'prompt', prompt: 'Summarize what changed.' },
    policy: {
      permissionTier: 'manual',
      memory: false,
      folderIds: [],
      maxDurationMinutes: 30,
      missedRuns: 'runOnce',
    },
    delivery: { notify: 'whenNew', includePreviousResult: false },
    ...fields,
  };
}

/** A command launch the engine made, as `launchCommand` received it. */
export interface Launched {
  request: LaunchCommandRequest;
  internal: InternalSubmitOptions;
}

export async function automationKit(start: string, options: { scanner?: FolderScanner } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'automation-kit-')));
  const paths = servicePaths(root);
  const ledger = await Ledger.load(paths);
  const events = new EventLog('automation-kit', 1);
  const folders = await FolderStore.load(root);
  const resources = new ResourceStore(ledger, paths);
  const clock = { now: Date.parse(start) };
  const submitted: Submitted[] = [];
  const launched: Launched[] = [];
  const answers = new Map<string, string>();
  // The kit's default model: a run needs some connection or env credentials to pass preflight.
  process.env.AI_AGENT_TEMP_API_KEY = 'automation-kit';

  const publish = (taskId: string, runId: string, status: RunStatus, error = '') =>
    events.publish({
      taskId,
      runId,
      executionId: `root:${runId}`,
      type: 'run.status',
      data: { status, error },
    });

  /** The task run starts: its maximum duration counts from here. */
  async function begin(taskId: string, runId: string) {
    await ledger.change((data) => {
      const run = data.tasks.find((task) => task.id === taskId)?.runs.find((r) => r.id === runId);
      if (run) run.status = 'running';
    });
    publish(taskId, runId, 'running');
  }

  async function finish(taskId: string, runId: string, status: RunStatus, answer = '') {
    if (answer) answers.set(runId, answer);
    await ledger.change((data) => {
      const run = data.tasks.find((task) => task.id === taskId)?.runs.find((r) => r.id === runId);
      if (run) run.status = status;
    });
    publish(taskId, runId, status, status === 'failed' ? 'The model request failed.' : '');
  }

  const manager: AutomationRuns = {
    async submit(request: SubmitTaskRequest, internal: InternalSubmitOptions = {}) {
      const known = ledger.operation(request.operationId);
      if (known) return { ...known, duplicate: true } satisfies SubmitTaskResponse;
      const taskId = request.taskId ?? randomUUID();
      const runId = randomUUID();
      const now = new Date(clock.now).toISOString();
      const task: AgentTask = {
        id: taskId,
        title: internal.title ?? request.input.text.slice(0, 120),
        createdAt: now,
        updatedAt: now,
        sessionFile: null,
        runs: [],
        rootTaskId: null,
        parentExecutionId: null,
        permissionTier: internal.permissionTier ?? 'manual',
        ...(internal.origin ? { origin: internal.origin } : {}),
      };
      await ledger.change((data) => {
        task.runs.push({
          id: runId,
          operationId: request.operationId,
          createdAt: now,
          status: 'queued',
          error: '',
          snapshot: {
            input: request.input,
            instructions: '',
            model: {
              connectionId: 'temp',
              modelId: 'kit',
              provider: 'openai-compatible',
              baseUrl: '',
            },
            tools: request.tools ?? [],
            memory: request.memory ?? true,
            ...(internal.trigger ? { trigger: internal.trigger } : {}),
          },
        });
        data.tasks.unshift(task);
        data.operations[request.operationId] = { taskId, runId };
      });
      submitted.push({ request, internal, taskId, runId });
      publish(taskId, runId, 'queued');
      return { taskId, runId, duplicate: false };
    },
    async cancel(taskId: string, runId: string) {
      const status = ledger.run(taskId, runId).status === 'queued' ? 'cancelled' : 'stopped';
      await finish(taskId, runId, status);
    },
    async snapshot(taskId: string) {
      const task = ledger.task(taskId);
      const blocks: ServiceBlock[] = task.runs.flatMap((run) => {
        const text = answers.get(run.id);
        if (text === undefined) return [];
        return [
          {
            kind: 'assistant',
            id: `${run.id}:answer`,
            runId: run.id,
            timestamp: 0,
            endedAt: 0,
            text,
            streaming: false,
            stopReason: 'stop',
            error: '',
          },
        ];
      });
      return { blocks };
    },
  };

  const deps = {
    paths,
    ledger,
    events,
    manager,
    // A command run is accepted like a prompt run; the launch request is kept for the test.
    launchCommand: (request: LaunchCommandRequest, internal: InternalSubmitOptions) => {
      launched.push({ request, internal });
      const { operationId, taskId, input } = request;
      return manager.submit({ operationId, ...(taskId ? { taskId } : {}), input }, internal);
    },
    folders,
    resources,
    log: quiet,
    now: () => clock.now,
    ...(options.scanner ? { scanner: options.scanner } : {}),
  };
  let service = await AutomationService.create(deps);

  /** Lets queued dispatches, supervision and settlement run to rest. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await service.engine.idle();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return {
    root,
    paths,
    ledger,
    events,
    folders,
    get service() {
      return service;
    },
    /** Stops the service and starts a new one on the same data, as a service restart would. */
    async restart() {
      await service.stop();
      service = await AutomationService.create(deps);
      await settle();
    },
    clock,
    submitted,
    launched,
    begin,
    finish,
    settle,
    create: (fields: Partial<AutomationDraft> = {}) =>
      createAutomation(service.edits(), draft(fields), 'user'),
    /** The automation's run records, newest first. */
    runs: (automationId: string) => service.store.data.state.automations[automationId]?.runs ?? [],
    async tick(at: string) {
      clock.now = Date.parse(at);
      await service.engine.tick(clock.now);
      await settle();
    },
    async stop() {
      await service.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}
