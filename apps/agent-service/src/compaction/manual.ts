import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { errorMessage, type CompactRefusal, type TaskRun } from '@ai/agent-contracts';
import { ConflictError } from '../errors.js';
import { bindLiveState, type LiveState } from '../live-state.js';
import type { SessionFactoryDeps } from '../pi-session.js';
import { openRunModel } from '../run-model.js';
import { buildSkillLoaderOptions } from '../skills/loader.js';
import { skillProfilePaths } from '../skills/profile.js';
import { sessionSkills } from '../skills/session-skills.js';
import { CompactionObserver } from './observer.js';
import { compactionSettings } from './policy.js';

export const NOTHING_TO_COMPACT =
  'There is nothing to compact: the conversation is still short or was just compacted.';

/** A refused compaction request: a 409 whose code clients word in their own language. */
export function compactRefused(code: CompactRefusal, message: string): ConflictError {
  return new ConflictError(message, code);
}

/**
 * Starts Pi's manual compaction on the task's session and returns once Pi prepared it
 * (compaction/observer.ts), before the summary request ends, with a promise of its end; `onEnd`
 * runs when it ends either way. It throws a ConflictError when the session cannot be opened or
 * Pi refuses (nothing to compact yet, just compacted). Progress and outcome reach clients as the
 * compaction block and `context.update` events; `done` rejects when the accepted compaction
 * failed. The result is wrapped because an async function would adopt a returned promise.
 */
export async function startManualCompaction(input: {
  live: () => Promise<LiveState>;
  instructions: string | undefined;
  /** Runs the compaction inside the session's memory scope (the memory flush writes). */
  wrap: <T>(action: () => Promise<T>) => Promise<T>;
  onEnd: () => void;
}): Promise<{ done: Promise<void> }> {
  let accept: () => void = () => undefined;
  let refuse: (error: Error) => void = () => undefined;
  const accepted = new Promise<void>((resolve, reject) => {
    accept = resolve;
    refuse = reject;
  });
  const done = (async () => {
    try {
      const live = await input.live();
      void live.compaction.nextPrepared().then(accept);
      await input.wrap(() => live.session.compact(input.instructions));
    } catch (error) {
      // Settling again is a no-op once the compaction was accepted.
      refuse(refusal(error));
      throw error;
    }
  })().finally(input.onEnd);
  try {
    await accepted;
  } catch (error) {
    // Refused: the thrown error carries the reason; the ended attempt has nothing to report.
    void done.catch(() => undefined);
    throw error;
  }
  return { done };
}

/** Why Pi would not start a compaction, as a 409 the caller can show. */
function refusal(error: unknown): ConflictError {
  if (error instanceof ConflictError) return error;
  const message = errorMessage(error);
  if (/Nothing to compact/i.test(message))
    return compactRefused('nothing_to_compact', NOTHING_TO_COMPACT);
  if (/Already compacted/i.test(message))
    return compactRefused(
      'nothing_to_compact',
      'The conversation was just compacted; there is nothing new to compact.',
    );
  return compactRefused('compaction_unavailable', `The context could not be compacted: ${message}`);
}

/**
 * A session opened only to compact an idle task without a live session, on its latest run's
 * model and frozen window. It loads no tools and no harness: pi-hermes-memory's pre-compaction
 * flush has nothing new to learn, since the shutdown flush that released the last live session
 * already read the same conversation. Skill re-attach stays, so skills a compaction drops return
 * the way they do in a run's session. Its binding key is empty, so the next run replaces it.
 */
export async function createCompactionState(
  deps: SessionFactoryDeps,
  run: TaskRun,
): Promise<LiveState> {
  const { ctx, taskId } = deps;
  const task = ctx.ledger.task(taskId);
  const [firstRun = run] = task.runs;
  if (!task.sessionFile) throw compactRefused('nothing_to_compact', NOTHING_TO_COMPACT);
  const skillProfile = skillProfilePaths(ctx.paths.root, ctx.paths.agentDir);
  const cwd = path.join(ctx.paths.tasksDir, taskId, 'output');
  await mkdir(skillProfile.loaderCwd, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const runModel = await openRunModel(ctx.paths, run);
  const settings = SettingsManager.inMemory(
    {
      retry: { enabled: false },
      defaultThinkingLevel: 'off',
      cacheWarming: 'off',
      ...compactionSettings(runModel.model),
    },
    { projectTrusted: false },
  );
  const manager = SessionManager.open(
    task.sessionFile,
    path.join(ctx.paths.sessionsDir, taskId),
    ctx.paths.agentDir,
  );
  const compaction = new CompactionObserver(manager);
  const loader = new DefaultResourceLoader(
    buildSkillLoaderOptions({
      loaderCwd: skillProfile.loaderCwd,
      agentDir: ctx.paths.agentDir,
      settingsManager: settings,
      systemPrompt: '',
      appendSystemPrompt: [],
      extensionFactories: [
        compaction.extension(),
        sessionSkills({ runId: deps.currentRunId, skills: () => [] }),
      ],
    }),
  );
  await loader.reload();
  const created = await createAgentSession({
    cwd,
    agentDir: ctx.paths.agentDir,
    modelRuntime: runModel.models,
    model: runModel.model,
    settingsManager: settings,
    sessionManager: manager,
    resourceLoader: loader,
    tools: [],
    thinkingLevel: run.snapshot.thinkingLevel ?? 'off',
  });
  await created.session.bindExtensions({
    mode: 'json',
    onError: (error) => ctx.log.warn('Extension error.', { taskId, error: error.error }),
  });
  const state = await bindLiveState({
    ctx,
    taskId,
    session: created.session,
    manager,
    runModel,
    compaction,
    bindingKey: '',
    currentRunId: deps.currentRunId,
    firstRunId: firstRun.id,
  });
  state.transcript.reproject(true);
  state.context.update();
  return state;
}
