import { errorMessage, type TaskRun } from '@ai/agent-contracts';
import { readAgentHarness } from './atd-agents/harness.js';
import { McpAuthority } from './mcp/index.js';
import { freezeRunMcp, releaseRunMcp } from './mcp/staging.js';
import { inSnapshot, mapPluginComponents } from './plugins/components.js';
import type { PluginAgent } from './plugins/map.js';
import { freezeRunPlugins, releaseRunPlugins } from './plugins/run-snapshot.js';
import type { PluginSkillSet } from './plugins/skill-set.js';
import {
  resolveRunReferences,
  type ReferenceContext,
  type RunReferences,
} from './references/material.js';
import { takeTaskReferences } from './references/staging.js';
import { ResourceStore } from './resources.js';
import { ensureSkillProfile, skillProfilePaths } from './skills/profile.js';
import { freezeRunRole } from './skills/roles.js';
import { captureRunSkills, skillChars, type RunSkills } from './skills/run-skills.js';
import { takeTaskStaging } from './skills/staging.js';
import { freezeSkillCatalog, type RunSkillCatalog } from './skills/skill-catalog.js';
import { freezeRunSkills, loadSkillCatalog, releaseRun } from './skills/versions.js';
import { SERVICE_RUNTIME_AGENTS, withPermissions, type RuntimeAgent } from './subagents/agents.js';
import { readServiceId } from './storage.js';
import type { RunnerContext } from './task-runner.js';

/** What a freeze needs from the task runner: its context, task and run audit. */
export interface RunFreezeDeps {
  ctx: RunnerContext;
  taskId: string;
  audit: (entry: Record<string, unknown>) => void;
}

/** What a run's freeze resolved for its material and session. */
export interface FrozenSelections {
  references: RunReferences;
  skills: RunSkills;
  /** The skills the run's model is told about and may load (skills/skill-catalog.ts). */
  catalog: RunSkillCatalog;
  /** The runtime agents the run's session registers: enabled system agents, then referenced specialists. */
  agents: RuntimeAgent[];
}

/**
 * Accept-time freeze of the selections staged for a task's next run. Staging
 * is consumed once here; the frozen role and MCP records are what the run's
 * session binding reads (run-binding.ts), the skills the run loads are
 * captured with their bodies, and the resolved references are returned for
 * the run's material and binding, so later staging never reaches this run.
 */
export async function freezeRunSelections(
  deps: RunFreezeDeps,
  run: TaskRun,
): Promise<FrozenSelections> {
  // The plugin catalog freezes first (D4): skills, agents and MCP below all read the run's
  // snapshot, so a plugin or item toggled later never changes what this run may use.
  const plugins = await freezePlugins(deps, run);
  const { toolCeiling, skills, catalog } = await freezeSkills(deps, run, plugins.skills);
  const mcp = await freezeMcp(deps, run);
  // Agents turned off in Settings stay off for this run even if they are turned on during it, and
  // a permission change made during the run applies from the next one.
  const { disabled: disabledAgents, permissions: agentPermissions } = await readAgentHarness(
    deps.ctx.paths.root,
  );
  const references = await freezeReferencesForRun(deps, run, {
    toolCeiling,
    mcp,
    skillChars: skillChars(run.id, skills.loaded, catalog),
    disabledAgents,
    agentPermissions,
    pluginAgents: plugins.agents,
  });
  const systemAgents = SERVICE_RUNTIME_AGENTS.filter(
    (agent) => !disabledAgents.has(agent.name),
  ).map((agent) => withPermissions(agent, agentPermissions.get(agent.name)));
  return { references, skills, catalog, agents: [...systemAgents, ...references.agents] };
}

/**
 * Releases the run's frozen skill, MCP and plugin records once the run ends; releasing the plugin
 * snapshot lets superseded plugin revisions be collected.
 */
export async function releaseRunSelections(deps: RunFreezeDeps, runId: string): Promise<void> {
  try {
    await releaseRun(skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir), runId);
    await releaseRunMcp(deps.ctx.paths.root, runId);
    await releaseRunPlugins(deps.ctx.paths.root, runId);
  } catch (error) {
    deps.ctx.log.warn('Run snapshot release failed.', {
      taskId: deps.taskId,
      error: errorMessage(error),
    });
  }
}

/**
 * Freezes the run's plugin snapshot (plugins/run-snapshot.ts) and answers what skills and agent
 * references read from it. A plugin failure never fails the run: it runs as before plugins, with
 * host skills only and no plugin agents or servers, and the audit says so.
 */
async function freezePlugins(
  deps: RunFreezeDeps,
  run: TaskRun,
): Promise<{ skills: PluginSkillSet; agents: ReadonlyMap<string, PluginAgent> }> {
  try {
    const plugins = await freezeRunPlugins(deps.ctx.paths.root, run.id);
    const components = await mapPluginComponents(plugins.host, plugins.view, new Set(['agent']));
    const agents = new Map<string, PluginAgent>(
      components.agents
        .filter(({ item }) => inSnapshot(plugins.snapshot, item))
        .map(({ value }) => [value.name, value]),
    );
    deps.audit({
      taskId: deps.taskId,
      runId: run.id,
      plugins: plugins.snapshot.plugins,
      pluginItems: Object.fromEntries(
        Object.entries(plugins.snapshot.items).map(([kind, names]) => [kind, names.length]),
      ),
    });
    return { skills: plugins.skills, agents };
  } catch (error) {
    deps.ctx.log.warn('Plugin freeze degraded: plugins are unavailable to this run.', {
      taskId: deps.taskId,
      error: errorMessage(error),
    });
    deps.audit({ taskId: deps.taskId, runId: run.id, pluginsDegraded: true });
    return {
      skills: { records: [], items: new Map(), effective: new Set(), sharedEnabled: true },
      agents: new Map(),
    };
  }
}

/**
 * Resolves the references staged for this run against the tool ceiling, MCP
 * state and skills frozen just before (references/material.ts). They reach
 * the run only through its material and session binding, so nothing is
 * written per run and nothing needs a release.
 */
async function freezeReferencesForRun(
  deps: RunFreezeDeps,
  run: TaskRun,
  frozen: Pick<
    ReferenceContext,
    'toolCeiling' | 'mcp' | 'skillChars' | 'disabledAgents' | 'agentPermissions' | 'pluginAgents'
  >,
): Promise<RunReferences> {
  const references = await takeTaskReferences(deps.ctx.paths.root, deps.taskId);
  const resolved = await resolveRunReferences(
    { ledger: deps.ctx.ledger, taskId: deps.taskId, run, ...frozen },
    references,
  );
  for (const entry of resolved.audit) deps.audit({ taskId: deps.taskId, runId: run.id, ...entry });
  return resolved;
}

/**
 * Freezes skills and the role, then captures the skills the run loads and the skill catalog its
 * model is told about, both from one read of the catalog. Answers those and the run's tool ceiling
 * for its children.
 */
async function freezeSkills(
  deps: RunFreezeDeps,
  run: TaskRun,
  plugins: PluginSkillSet,
): Promise<{ toolCeiling: string[]; skills: RunSkills; catalog: RunSkillCatalog }> {
  // T3 additive freeze: staged next-run selection is consumed once; runs
  // without staging freeze empty skills + the default role (T1/T2 shape).
  const profile = skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir);
  await ensureSkillProfile(profile);
  const staging = await takeTaskStaging(profile, deps.taskId);
  const catalogRecords = await loadSkillCatalog(profile, plugins);
  const snapshot = await freezeRunSkills(profile, run.id, staging.skills, catalogRecords);
  const { role, capabilities } = await freezeRunRole(profile, {
    runId: run.id,
    roleId: staging.roleId,
    requestedTools: [...run.snapshot.tools],
    requestedSkills: snapshot.skills.map((skill) => skill.name),
  });
  const skills = await captureRunSkills(snapshot, capabilities);
  const catalog = freezeSkillCatalog(catalogRecords, role, capabilities.revokedSkills);
  deps.audit({
    taskId: deps.taskId,
    runId: run.id,
    skillRevision: snapshot.revision,
    skillCount: snapshot.skills.length,
    loadedSkills: skills.loaded.map(({ name, revision }) => ({ name, revision })),
    skillDiagnostics: skills.diagnostics,
    skillCatalog: {
      loadable: catalog.invocable.length,
      userOnly: catalog.userOnly.length,
      chars: catalog.text.length,
    },
  });
  return { toolCeiling: capabilities.tools, skills, catalog };
}

/** Freezes the run's MCP servers and its staged tool selection, if any. */
async function freezeMcp(
  deps: RunFreezeDeps,
  run: TaskRun,
): Promise<NonNullable<ReferenceContext['mcp']>> {
  // MCP run freeze: captures the authority snapshot revision once at accept.
  // Pi binds proxies from this revision; later config edits bump the live
  // revision and apply next run.
  const { ctx } = deps;
  const serviceId = await readServiceId(ctx.paths);
  const authority = await McpAuthority.authorityFor({
    serviceId,
    dataDir: ctx.paths.root,
    cwd: ctx.paths.root,
    events: ctx.events,
    confirms: ctx.confirms,
    resources: new ResourceStore(ctx.ledger, ctx.paths),
    log: ctx.log,
  });
  const snapshot = authority.snapshot();
  const staged = await freezeRunMcp(ctx.paths.root, deps.taskId, run.id);
  deps.audit({
    taskId: deps.taskId,
    runId: run.id,
    mcpRevision: snapshot.revision,
    mcpServers: snapshot.servers.length,
    mcpStaged: staged ? staged.tools.length : null,
  });
  return {
    servers: await authority.runServers(run.id),
    selected: staged ? staged.tools : null,
  };
}
