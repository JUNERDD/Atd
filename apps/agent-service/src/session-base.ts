import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import type { TaskRun } from '@atd/agent-contracts';
import { CompactionObserver } from './compaction/observer.js';
import { compactionSettings } from './compaction/policy.js';
import { markInvocation } from './invocation-marker.js';
import { bindLiveState, type LiveState } from './live-state.js';
import type { SessionFactoryDeps } from './pi-session.js';
import { REQUEST_POLICY } from './request-policy.js';
import { openRunModel, type RunModel } from './run-model.js';
import { rewindManager } from './session-rewind.js';
import { buildSkillLoaderOptions } from './skills/loader.js';
import { skillProfilePaths } from './skills/profile.js';
import { timePreparation } from './run-preparation-timing.js';

/**
 * What every run session of a task stands on, whichever path built it (pi-session.ts for the full
 * session, lite-session.ts for the lightweight one): the task's session file, the run's model and
 * the service request and compaction policies. Only the system prompt, extensions and tools differ.
 */
export interface SessionBase {
  /** The task's output dir, the session's cwd; never where resources load from. */
  cwd: string;
  /** The service profile cwd resources load from, so task files never become Pi configuration. */
  loaderCwd: string;
  runModel: RunModel;
  settings: SettingsManager;
  manager: SessionManager;
  compaction: CompactionObserver;
}

/**
 * Opens the run's model and the task's session file (a new one for its first run), with a
 * replacing run's branch already rewound, so the session's context and extension state start on
 * the new branch.
 */
export async function openSessionBase(
  deps: SessionFactoryDeps,
  run: TaskRun,
): Promise<SessionBase> {
  const { ctx, taskId } = deps;
  const sessionsDir = path.join(ctx.paths.sessionsDir, taskId);
  const cwd = path.join(ctx.paths.tasksDir, taskId, 'output');
  const { loaderCwd } = skillProfilePaths(ctx.paths.root, ctx.paths.agentDir);
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(loaderCwd, { recursive: true });
  const runModel = await timePreparation('model_runtime', () => openRunModel(ctx.paths, run));
  const settings = SettingsManager.inMemory(
    {
      ...REQUEST_POLICY,
      defaultThinkingLevel: 'off',
      cacheWarming: 'off',
      ...compactionSettings(runModel.model),
    },
    // T3: projectTrusted:false from the first read; task cwd settings excluded.
    { projectTrusted: false },
  );
  const task = ctx.ledger.task(taskId);
  const manager = task.sessionFile
    ? SessionManager.open(task.sessionFile, sessionsDir, ctx.paths.agentDir)
    : SessionManager.create(ctx.paths.agentDir, sessionsDir);
  if (run.snapshot.branchBefore) rewindManager(manager, run.snapshot.branchBefore);
  return {
    cwd,
    loaderCwd,
    runModel,
    settings,
    manager,
    compaction: new CompactionObserver(manager),
  };
}

/** What a session path adds to its base. */
export interface RunSessionSpec {
  systemPrompt: string;
  extensionFactories: InlineExtension[];
  /** Pi's tool allowlist. */
  tools: string[];
  /** `LiveState.bindingKey`: which later runs may reuse the session. */
  bindingKey: string;
  /** Runs once Pi created the session, before its extensions bind. */
  created?: (session: AgentSession) => void;
}

/**
 * Builds the run's Pi session on `base` and follows it as the task's live state: its extensions
 * bind, a Stop requested meanwhile ends its first agent run, and the run's invocation marker opens
 * its turn before the transcript is projected.
 */
export async function buildRunSession(
  deps: SessionFactoryDeps,
  run: TaskRun,
  base: SessionBase,
  spec: RunSessionSpec,
): Promise<LiveState> {
  const { ctx, taskId } = deps;
  // The run that owns a session's unmarked start; a new task's first run is this one.
  const [firstRun = run] = ctx.ledger.task(taskId).runs;
  const loader = new DefaultResourceLoader(
    buildSkillLoaderOptions({
      loaderCwd: base.loaderCwd,
      agentDir: ctx.paths.agentDir,
      settingsManager: base.settings,
      systemPrompt: spec.systemPrompt,
      appendSystemPrompt: [],
      extensionFactories: spec.extensionFactories,
    }),
  );
  await timePreparation('resource_loader', () => loader.reload());
  if (loader.getExtensions().errors.length)
    throw new Error('An Agent extension could not be loaded.');
  const created = await timePreparation('agent_session', () =>
    createAgentSession({
      cwd: base.cwd,
      agentDir: ctx.paths.agentDir,
      modelRuntime: base.runModel.models,
      model: base.runModel.model,
      settingsManager: base.settings,
      sessionManager: base.manager,
      resourceLoader: loader,
      tools: spec.tools,
      thinkingLevel: run.snapshot.thinkingLevel ?? 'off',
    }),
  );
  spec.created?.(created.session);
  await timePreparation('bind_extensions', () =>
    created.session.bindExtensions({
      mode: 'json',
      onError: (error) => {
        ctx.log.warn('Extension error.', { taskId, error: error.error });
      },
    }),
  );
  // Pi compacts before sending a prompt, before its agent run starts, and a Stop meanwhile aborts
  // only that compaction; the prompt would still be sent. Stop it as soon as its run starts.
  created.session.subscribe((event) => {
    if (event.type === 'agent_start' && deps.stopRequested()) void created.session.abort();
  });
  const state = await timePreparation('attach_live_state', () =>
    bindLiveState({
      ctx,
      taskId,
      session: created.session,
      manager: base.manager,
      runModel: base.runModel,
      compaction: base.compaction,
      bindingKey: spec.bindingKey,
      currentRunId: deps.currentRunId,
      firstRunId: firstRun.id,
    }),
  );
  markInvocation(base.manager, run);
  state.transcript.reproject(true);
  state.context.update();
  return state;
}
