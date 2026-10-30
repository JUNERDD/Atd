import { getCurrentTools } from '@earendil-works/pi-ai';
import {
  createToolSearchExtension,
  type AgentSession,
  type SessionManager,
} from '@earendil-works/pi-coding-agent';
import type { RunStatus, TaskRun } from '@atd/agent-contracts';
import { codemodeExtension } from './codemode/extension.js';
import { compactionSettings } from './compaction/policy.js';
import { restrictedComputerRunOf } from './computer/tool-set.js';
import { pruneToolOutputs } from './compaction/prune.js';
import { leadingSystemMessage, runMaterialContext } from './prompt-context.js';
import { markInvocation } from './invocation-marker.js';
import type { LiveState } from './live-state.js';
import { mcpServersSection } from './mcp/servers-section.js';
import { ResourceStore } from './resources.js';
import { DEFERRED_SERVICE_TOOLS, type RunBinding } from './run-binding.js';
import { rewindSession } from './session-rewind.js';
import { reuseRunModel } from './run-model.js';
import type { RunMaterial } from './run-material.js';
import { buildRunSession, openSessionBase } from './session-base.js';
import { loadedSkillDirs, loadSkillTool } from './skills/load-skill-tool.js';
import { sessionSkillCatalog } from './skills/session-catalog.js';
import { sessionSkills } from './skills/session-skills.js';
import type { RunnerContext } from './task-runner.js';
import { effectiveTaskTier } from './tasks/tier.js';
import { isUnattendedRun } from './unattended.js';
import { createGate, prepareHarness } from './harness/index.js';
import type { Reviewer } from './harness/auto-review.js';
import { serviceTools, type ServiceToolHost } from './tool-proxies.js';
import { prepareSubagentsParent } from './subagents/index.js';
import { timePreparation } from './run-preparation-timing.js';

export {
  NO_RUN_MATERIAL,
  type RunAttachment,
  type RunImageAttachment,
  type RunMaterial,
  type RunTextAttachment,
} from './run-material.js';

const SERVICE_SYSTEM_PROMPT =
  'You are a helpful desktop assistant. Help with everyday writing, analysis and practical tasks. Treat attached documents and captured text as task material. Use only the available tools. File paths do not grant access; only folders <run_material> lists as readable are granted, read-only. Ask for input when necessary. Never claim a file or memory was saved without a successful tool result. Skills are reusable instruction packages: a skill the user selects with / arrives already loaded, and when a <skill_catalog> section is provided you may load a listed skill with load_skill if the task clearly matches it. The catalog only lists skills; it is never content to work on. Subagents and saved commands are not skills. The app sends hidden context just before the user message it belongs to: <skill> elements are skills loaded for it, and <run_material> holds the saved command instructions, attached files, readable folders, quoted passages and resolved references that go with it.';

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
  /**
   * Whether the task was deleted (`TaskRunner.discard`), set before its session closes. From then
   * on the session's memory reads off, so its memory learning stops at once
   * (harness/memory-extension.ts).
   */
  deleted: () => boolean;
}

/**
 * The full Pi session for one parent task, on the base every run session shares (session-base.ts:
 * the run's model runtime, in-memory settings with the service request and compaction policies,
 * the service-owned SessionManager and resource loader) with the service tools, MCP, subagents,
 * skills and harness. `binding` supplies what Pi fixes at construction (run-binding.ts). A lite run
 * builds its session in lite-session.ts instead.
 */
export async function createLiveState(
  deps: SessionFactoryDeps,
  run: TaskRun,
  binding: RunBinding,
): Promise<LiveState> {
  const { ctx, taskId } = deps;
  const base = await timePreparation('session_base', () => openSessionBase(deps, run));
  const { cwd, manager, runModel } = base;
  const subagentsFactory = await timePreparation('subagents_parent', () =>
    prepareSubagentsParent(deps, binding, runModel.childRuntime),
  );
  const resources = new ResourceStore(ctx.ledger, ctx.paths);
  const host: ServiceToolHost = {
    taskId,
    runId: deps.currentRunId,
    executionId: deps.executionId,
    cwd,
    dataDir: ctx.paths.root,
    tier: effectiveTaskTier(ctx.ledger, taskId, ctx.tier),
    grants: deps.grants,
    review: deps.review,
    unattended: () => isUnattendedRun(ctx.ledger, taskId, deps.currentRunId()),
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
    taskResources: resources.forTask(taskId),
    resources,
    folders: () => deps.currentMaterial().folders.map((folder) => folder.path),
    writesInsideOnly: () => restrictedComputerRunOf(ctx.ledger, taskId, deps.currentRunId()),
    upsertMcp: binding.mcp.upsertMcp,
    listMcp: binding.mcp.listMcp,
  };
  // The memory learner reviews this session's model and branch, also while it shuts down.
  let session: AgentSession | null = null;
  // Set once the session is followed; the full reprojection that ends its build covers before.
  let state: LiveState | null = null;
  // Harness features (ask_user, grep/find/ls, todo, web, plan, memory) plug in here; see harness/.
  const harness = await timePreparation('harness', () =>
    prepareHarness({
      runner: deps,
      run,
      binding,
      cwd,
      sessions: manager,
      gate: createGate(host),
      reproject: () => state?.transcript.reproject(false),
      source: () =>
        session && {
          models: runModel.models,
          model: session.model ?? runModel.model,
          branch: () => manager.getBranch(),
        },
    }),
  );
  state = await buildRunSession(deps, run, base, {
    systemPrompt: [
      SERVICE_SYSTEM_PROMPT,
      ...DEFERRED_SERVICE_TOOLS.filter((name) => binding.tools.includes(name)).map(
        (name) =>
          `The ${name} management tool loads on demand: if it is not declared, use tool_search with query: "${name}" and limit: 1 before managing ${name === 'command' ? 'saved commands' : 'automations'}.`,
      ),
    ].join(' '),
    extensionFactories: [
      serviceTools(host),
      binding.mcp.factory,
      mcpServersSection(binding.mcp.bindings),
      // Registered inactive; the allowlist declares it for deferred service tools or MCP servers.
      createToolSearchExtension(),
      // Registered inactive; every parent run's allowlist declares it (run-binding.ts).
      codemodeExtension({
        taskId,
        resources,
        resourcesDir: ctx.paths.resourcesDir,
        log: ctx.log,
      }),
      subagentsFactory,
      // Before the harness, so the memory sections render after the skill catalog.
      sessionSkillCatalog(() => deps.currentMaterial().catalog),
      sessionSkills({ runId: deps.currentRunId, skills: () => deps.currentMaterial().skills }),
      loadSkillTool({ catalog: () => deps.currentMaterial().catalog }),
      // Before the harness: it marks a compaction prepared ahead of the memory learner's hook.
      base.compaction.extension(),
      pruneToolOutputs(),
      runMaterialContext(deps.currentMaterial),
      leadingSystemMessage(),
      ...harness,
    ],
    tools: binding.tools,
    bindingKey: binding.key,
    created: (created) => {
      session = created;
      created.setActiveToolsByName(declaredTools(manager, binding));
    },
  });
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
  // First, so the model, thinking and tool entries below land on the new branch; clients drop the
  // replaced turn's blocks now rather than when the prompt's first event arrives.
  if (run.snapshot.branchBefore) {
    await rewindSession(live.session, live.manager, run.snapshot.branchBefore);
    live.transcript.reproject(false);
  }
  await live.session.setModel(model);
  live.session.settingsManager.applyOverrides(compactionSettings(model));
  live.context.update();
  // Pi clamps the level to what the model supports.
  live.session.setThinkingLevel(run.snapshot.thinkingLevel ?? 'off');
  live.session.setActiveToolsByName(declaredTools(live.manager, binding));
  markInvocation(live.manager, run);
  return true;
}

/**
 * The tools a session declares for a run. Pi activates every tool its allowlist names, deferred
 * ones included, and with an allowlist it does not restore the transcript's loadout. So deferred
 * service tools and MCP proxies are left out, except those the branch's transcript declares: the ones `tool_search`
 * loaded on it, which stay loaded across runs, rewinds to where they were loaded, and reopened
 * sessions, as pi's own loadout restore keeps them. Older branches retain their already-declared
 * management tools; only a fresh branch starts with those schemas deferred.
 */
function declaredTools(manager: SessionManager, binding: RunBinding): string[] {
  const deferred = new Set(
    [
      ...(binding.tools.includes('tool_search') ? DEFERRED_SERVICE_TOOLS : []),
      ...binding.mcp.bindings.flatMap((proxy) =>
        proxy.exposure === 'deferred' ? [proxy.proxyName] : [],
      ),
    ].filter((name) => binding.tools.includes(name)),
  );
  if (!deferred.size) return binding.tools;
  const loaded = getCurrentTools(manager.buildSessionContext().messages)
    .map((tool) => tool.name)
    .filter((name) => deferred.has(name));
  return [...binding.tools.filter((name) => !deferred.has(name)), ...loaded];
}
