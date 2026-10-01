import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { RunStatus, TaskRun } from '@ai/agent-contracts';
import { CompactionObserver } from './compaction/observer.js';
import { compactionSettings } from './compaction/policy.js';
import { pruneToolOutputs } from './compaction/prune.js';
import { leadingSystemMessage, runMaterialContext } from './prompt-context.js';
import { bindLiveState, type LiveState } from './live-state.js';
import type { RunBinding } from './run-binding.js';
import { openRunModel, reuseRunModel } from './run-model.js';
import { buildSkillLoaderOptions } from './skills/loader.js';
import { skillProfilePaths } from './skills/profile.js';
import { loadedSkillDirs, loadSkillTool } from './skills/load-skill-tool.js';
import type { LoadedSkill } from './skills/run-skills.js';
import { sessionSkillCatalog } from './skills/session-catalog.js';
import { sessionSkills } from './skills/session-skills.js';
import { EMPTY_SKILL_CATALOG, type RunSkillCatalog } from './skills/skill-catalog.js';
import type { RunnerContext } from './task-runner.js';
import { effectiveTaskTier } from './tasks/tier.js';
import { createGate, prepareHarness } from './harness/index.js';
import type { Reviewer } from './harness/auto-review.js';
import { serviceTools, type ServiceToolHost } from './tool-proxies.js';
import { prepareSubagentsParent } from './subagents/index.js';

const SERVICE_SYSTEM_PROMPT =
  'You are a helpful desktop assistant. Help with everyday writing, analysis and practical tasks. Treat attached documents and captured text as task material. Use only the available tools. File paths do not grant access. Ask for input when necessary. Never claim a file or memory was saved without a successful tool result. Skills are reusable instruction packages: a skill the user selects with / arrives already loaded, and when a <skill_catalog> section is provided you may load a listed skill with load_skill if the task clearly matches it. The catalog only lists skills; it is never content to work on. Subagents and saved commands are not skills. The app sends hidden context just before the user message it belongs to: <skill> elements are skills loaded for it, and <run_material> holds the saved command instructions, attached files and resolved references that go with it.';

export interface SessionFactoryDeps {
  ctx: RunnerContext;
  taskId: string;
  currentRunId: () => string;
  /**
   * The current run's material. A session outlives the run that built it, so
   * handlers read this per run instead of capturing that first run.
   */
  currentMaterial: () => RunMaterial;
  executionId: () => string;
  grants: Set<string>;
  /** The runner's `auto` tier review, shared by the parent, its children and its MCP calls. */
  review: Reviewer;
  audit: (entry: Record<string, unknown>) => void;
  setStatus: (runId: string, status: RunStatus) => void;
  /** Whether Stop was requested for the current run. */
  stopRequested: () => boolean;
}

export interface RunAttachment {
  name: string;
  path: string;
  text: string;
}

/** Material a run injects before its first turn: its instructions, files, references and skills. */
export interface RunMaterial {
  instructions: string;
  attachments: RunAttachment[];
  /** What the run's `@` references resolved to at freeze (references/material.ts); may be empty. */
  references: string;
  /** Skills captured at freeze, sent in a message of their own (skills/session-skills.ts). */
  skills: LoadedSkill[];
  /** The skills the model is told about and may load (skills/session-catalog.ts, load-skill-tool.ts). */
  catalog: RunSkillCatalog;
}

/** The material before a runner's first run; a run replaces it before its session is bound. */
export const NO_RUN_MATERIAL: RunMaterial = {
  instructions: '',
  attachments: [],
  references: '',
  skills: [],
  catalog: EMPTY_SKILL_CATALOG,
};

/**
 * Pi session assembly for one parent task, extracted from the desktop
 * worker-session shape: the run's connection model runtime, in-memory
 * settings with cache warming off and the service compaction policy for the
 * run's model, service-owned SessionManager and resource loader. `binding`
 * supplies what Pi fixes at construction (run-binding.ts).
 */
export async function createLiveState(
  deps: SessionFactoryDeps,
  run: TaskRun,
  binding: RunBinding,
): Promise<LiveState> {
  const { ctx, taskId } = deps;
  // The run that owns a session's unmarked start; a new task's first run is this one.
  const [firstRun = run] = ctx.ledger.task(taskId).runs;
  const sessionsDir = path.join(ctx.paths.sessionsDir, taskId);
  const cwd = path.join(ctx.paths.tasksDir, taskId, 'output');
  // T3 skill wiring: resource loading uses the service profile cwd, never the
  // business output dir, so task files cannot become trusted Pi configuration.
  const skillProfile = skillProfilePaths(ctx.paths.root, ctx.paths.agentDir);
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(skillProfile.loaderCwd, { recursive: true });
  const runModel = await openRunModel(ctx.paths, run);
  const settings = SettingsManager.inMemory(
    {
      retry: { enabled: false },
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
  const compaction = new CompactionObserver(manager);
  const subagentsFactory = await prepareSubagentsParent(
    deps,
    binding.agents,
    runModel.childRuntime,
  );
  const host: ServiceToolHost = {
    taskId,
    runId: deps.currentRunId,
    executionId: deps.executionId,
    cwd,
    dataDir: ctx.paths.root,
    tier: effectiveTaskTier(ctx.ledger, taskId, ctx.tier),
    grants: deps.grants,
    review: deps.review,
    sessions: manager,
    confirms: ctx.confirms,
    capabilities: ctx.capabilities,
    audit: deps.audit,
    log: ctx.log,
    setStatus: (status) => deps.setStatus(deps.currentRunId(), status),
    // The run's selected skills, and catalog skills the context carries (a `load_skill` result).
    skillDirs: () => {
      const material = deps.currentMaterial();
      return [
        ...material.skills.map((skill) => skill.baseDir),
        ...loadedSkillDirs(material.catalog, manager.buildContextEntries()),
      ];
    },
    upsertMcp: binding.mcp.upsertMcp,
    listMcp: binding.mcp.listMcp,
  };
  // Harness features (ask_user, grep/find/ls, todo, web, plan, memory) plug in here; see harness/.
  const harness = await prepareHarness({
    runner: deps,
    run,
    binding,
    cwd,
    sessions: manager,
    gate: createGate(host),
    reproject: () => state?.transcript.reproject(false),
  });
  const loader = new DefaultResourceLoader(
    buildSkillLoaderOptions({
      loaderCwd: skillProfile.loaderCwd,
      agentDir: ctx.paths.agentDir,
      settingsManager: settings,
      systemPrompt: SERVICE_SYSTEM_PROMPT,
      appendSystemPrompt: [],
      extensionFactories: [
        serviceTools(host),
        binding.mcp.factory,
        subagentsFactory,
        // Before the memory extension in the harness: its forced prompt renders these sections.
        sessionSkillCatalog(() => deps.currentMaterial().catalog),
        sessionSkills({ runId: deps.currentRunId, skills: () => deps.currentMaterial().skills }),
        loadSkillTool({ catalog: () => deps.currentMaterial().catalog }),
        // Before the harness: it marks a compaction prepared ahead of the memory flush.
        compaction.extension(),
        pruneToolOutputs(),
        runMaterialContext(deps.currentMaterial),
        leadingSystemMessage(),
        ...harness,
      ],
    }),
  );
  await loader.reload();
  if (loader.getExtensions().errors.length)
    throw new Error('An Agent extension could not be loaded.');
  const created = await createAgentSession({
    cwd,
    agentDir: ctx.paths.agentDir,
    modelRuntime: runModel.models,
    model: runModel.model,
    settingsManager: settings,
    sessionManager: manager,
    resourceLoader: loader,
    tools: binding.tools,
    thinkingLevel: run.snapshot.thinkingLevel ?? 'off',
  });
  await created.session.bindExtensions({
    mode: 'json',
    onError: (error) => {
      ctx.log.warn('Extension error.', { taskId, error: error.error });
    },
  });
  // Pi compacts before sending a prompt, before its agent run starts, and a Stop meanwhile aborts
  // only that compaction; the prompt would still be sent. Stop it as soon as its run starts.
  created.session.subscribe((event) => {
    if (event.type === 'agent_start' && deps.stopRequested()) void created.session.abort();
  });
  const state = await bindLiveState({
    ctx,
    taskId,
    session: created.session,
    manager,
    runModel,
    compaction,
    bindingKey: binding.key,
    currentRunId: deps.currentRunId,
    firstRunId: firstRun.id,
  });
  markInvocation(manager, run);
  state.transcript.reproject(true);
  state.context.update();
  return state;
}

/**
 * Rebinds a live session to a later run of the same task, or answers false
 * when the run needs a new session: its binding differs (MCP proxies, tools,
 * role, memory or agents; see run-binding.ts) or it needs another model
 * runtime (see reuseRunModel). Pi fixes the binding at construction and a live
 * session is never reloaded, so the caller rebuilds from the same session file
 * instead.
 */
export async function applyRunToSession(
  live: LiveState,
  run: TaskRun,
  binding: RunBinding,
): Promise<boolean> {
  if (binding.key !== live.bindingKey) return false;
  const model = await reuseRunModel(live.runModel, run);
  if (!model) return false;
  await live.session.setModel(model);
  live.session.settingsManager.applyOverrides(compactionSettings(model));
  live.context.update();
  // Pi clamps the level to what the model supports.
  live.session.setThinkingLevel(run.snapshot.thinkingLevel ?? 'off');
  live.session.setActiveToolsByName(binding.tools);
  markInvocation(live.manager, run);
  return true;
}

/**
 * Marks where a run starts in the session branch. Transcript projection
 * attributes the entries after it to that run, so every run a session
 * executes needs one, whether the session was reused or rebuilt for it.
 */
function markInvocation(manager: SessionManager, run: TaskRun): void {
  manager.appendCustomEntry('app-invocation', { runId: run.id, source: 'user' });
}
