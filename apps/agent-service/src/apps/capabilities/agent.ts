import { randomUUID } from 'node:crypto';
import { Compile } from 'typebox/compile';
import {
  RunStatusDataSchema,
  snapshotToolsFor,
  type AgentRunChunk,
  type AgentRunInput,
  type AgentRunOutput,
  type RunStatus,
  type ServiceEvent,
} from '@atd/agent-contracts';
import type { EventLog } from '../../event-log.js';
import type { Ledger } from '../../ledger.js';
import type { RunnerManager } from '../../runner-manager.js';
import { skillProfilePaths, ensureSkillProfile } from '../../skills/profile.js';
import { stageTaskSkills } from '../../skills/staging.js';
import type { ServicePaths } from '../../storage.js';

const RunStatusValidator = Compile(RunStatusDataSchema);
const FINISHED: ReadonlySet<RunStatus> = new Set([
  'stopped',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'unknown',
]);

export interface AgentRunDeps {
  paths: ServicePaths;
  ledger: Ledger;
  manager: RunnerManager;
  events: EventLog;
}

/** A transcript block's fields this projection reads; blocks arrive as untrusted JSON. */
function blockField(block: unknown, name: string): unknown {
  return typeof block === 'object' && block !== null ? Reflect.get(block, name) : undefined;
}

const TOOL_STATUS: Record<string, 'running' | 'completed' | 'failed'> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  declined: 'failed',
  interrupted: 'failed',
};

/**
 * `agent.run`: a new task with origin `{ kind: 'app', appId }`, submitted like any other through
 * `RunnerManager.submit`, so its tools pass the same gate at the task's tier and its confirms
 * show in the panel, and the user finds it in history. `skills` are staged for its run the way
 * the composer stages them. Run status, tool progress and answer text stream as chunks; aborting
 * (the backend cancelled, or stopped) cancels the run.
 */
export async function agentRun(
  deps: AgentRunDeps,
  appId: string,
  input: AgentRunInput,
  signal: AbortSignal,
  onChunk: (chunk: AgentRunChunk) => void,
): Promise<AgentRunOutput> {
  signal.throwIfAborted();
  const taskId = randomUUID();
  if (input.skills?.length) {
    const profile = skillProfilePaths(deps.paths.root, deps.paths.agentDir);
    await ensureSkillProfile(profile);
    await stageTaskSkills(
      profile,
      taskId,
      input.skills.map((name) => ({ name })),
    );
  }
  let runId = '';
  const texts = new Map<string, string>();
  const tools = new Map<string, string>();
  let settle: (status: RunStatus) => void = () => undefined;
  const finished = new Promise<RunStatus>((resolve) => {
    settle = resolve;
  });
  const onEvent = (event: ServiceEvent) => {
    if (event.taskId !== taskId || (runId && event.runId !== runId)) return;
    if (event.type === 'run.status' && RunStatusValidator.Check(event.data)) {
      onChunk({ type: 'status', status: event.data.status });
      if (FINISHED.has(event.data.status)) settle(event.data.status);
    } else if (event.type === 'transcript.patch') {
      const blocks: unknown = blockField(event.data, 'blocks');
      for (const block of Array.isArray(blocks) ? blocks : []) project(block);
    }
  };
  const project = (block: unknown) => {
    const id = blockField(block, 'id');
    const kind = blockField(block, 'kind');
    if (typeof id !== 'string') return;
    if (kind === 'assistant') {
      const text = blockField(block, 'text');
      if (typeof text !== 'string') return;
      const previous = texts.get(id) ?? '';
      texts.set(id, text);
      if (text.length > previous.length && text.startsWith(previous))
        onChunk({ type: 'text', delta: text.slice(previous.length) });
    } else if (kind === 'tool') {
      const name = blockField(block, 'name');
      const status = TOOL_STATUS[String(blockField(block, 'status'))];
      if (typeof name !== 'string' || !status || tools.get(id) === status) return;
      tools.set(id, status);
      onChunk({ type: 'tool', name: name.slice(0, 128), status });
    }
  };
  const unsubscribe = deps.events.onPublish(onEvent);
  try {
    const accepted = await deps.manager.submit({
      operationId: randomUUID(),
      taskId,
      input: {
        text: input.prompt,
        source: 'manual',
        capturedAt: new Date().toISOString(),
        selection: '',
        clipboard: '',
        files: [],
        arguments: {},
        // Plain text: an app's prompt never turns into skill chips.
        chips: [],
        folders: [],
      },
      ...(input.tools ? { tools: snapshotToolsFor(input.tools) } : {}),
    });
    runId = accepted.runId;
    await deps.ledger.change((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (task) task.origin = { kind: 'app', appId };
    });
    const cancel = () =>
      void deps.manager
        .cancel(taskId, runId)
        .catch(() => undefined)
        // A run cancelled before it started publishes no further status.
        .finally(() => settle('cancelled'));
    signal.addEventListener('abort', cancel, { once: true });
    const current = deps.ledger.run(taskId, runId).status;
    if (FINISHED.has(current)) settle(current);
    const status = await finished.finally(() => signal.removeEventListener('abort', cancel));
    signal.throwIfAborted();
    const answer = [...texts.values()].filter((text) => text.trim()).at(-1) ?? '';
    return { taskId, runId, status, text: answer };
  } finally {
    unsubscribe();
  }
}
