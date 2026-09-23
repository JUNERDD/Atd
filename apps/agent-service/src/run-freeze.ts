import { errorMessage, type TaskRun } from '@ai/agent-contracts';
import { McpAdapterMissing, McpAuthority } from './mcp/index.js';
import { freezeRunMcp, releaseRunMcp } from './mcp/staging.js';
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
import { freezeRunSkills, releaseRun } from './skills/versions.js';
import { readServiceId, type RunnerContext } from './task-runner.js';

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
  const { toolCeiling, skills } = await freezeSkills(deps, run);
  const mcp = await freezeMcp(deps, run);
  const references = await freezeReferencesForRun(deps, run, {
    toolCeiling,
    mcp,
    skillChars: skillChars(run.id, skills.loaded),
  });
  return { references, skills };
}

/** Releases the run's frozen skill and MCP records once the run ends. */
export async function releaseRunSelections(deps: RunFreezeDeps, runId: string): Promise<void> {
  try {
    await releaseRun(skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir), runId);
    await releaseRunMcp(deps.ctx.paths.root, runId);
  } catch (error) {
    deps.ctx.log.warn('Run snapshot release failed.', {
      taskId: deps.taskId,
      error: errorMessage(error),
    });
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
  frozen: Pick<ReferenceContext, 'toolCeiling' | 'mcp' | 'skillChars'>,
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
 * Freezes skills and the role, then captures the skills the run loads.
 * Answers those skills and the run's tool ceiling for its children.
 */
async function freezeSkills(
  deps: RunFreezeDeps,
  run: TaskRun,
): Promise<{ toolCeiling: string[]; skills: RunSkills }> {
  // T3 additive freeze: staged next-run selection is consumed once; runs
  // without staging freeze empty skills + the default role (T1/T2 shape).
  const profile = skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir);
  await ensureSkillProfile(profile);
  const staging = await takeTaskStaging(profile, deps.taskId);
  const snapshot = await freezeRunSkills(profile, run.id, staging.skills);
  const { capabilities } = await freezeRunRole(profile, {
    runId: run.id,
    roleId: staging.roleId,
    requestedTools: [...run.snapshot.tools],
    requestedSkills: snapshot.skills.map((skill) => skill.name),
  });
  const skills = await captureRunSkills(snapshot, capabilities);
  deps.audit({
    taskId: deps.taskId,
    runId: run.id,
    skillRevision: snapshot.revision,
    skillCount: snapshot.skills.length,
    loadedSkills: skills.loaded.map(({ name, revision }) => ({ name, revision })),
    skillDiagnostics: skills.diagnostics,
  });
  return { toolCeiling: capabilities.tools, skills };
}

/** Freezes the run's MCP selection; answers the servers and selection, or null while degraded. */
async function freezeMcp(deps: RunFreezeDeps, run: TaskRun): Promise<ReferenceContext['mcp']> {
  // MCP run freeze: captures the authority snapshot revision once at accept.
  // Pi binds proxies from this revision; later config edits bump the live
  // revision and apply next run. McpAdapterMissing degrades explicitly with
  // audit + warning; the run continues without MCP (never silent, never
  // fatal to skills).
  const { ctx } = deps;
  try {
    const serviceId = await readServiceId(ctx.paths);
    const authority = await McpAuthority.authorityFor({
      serviceId,
      dataDir: ctx.paths.root,
      agentDir: ctx.paths.agentDir,
      sessionsDir: ctx.paths.sessionsDir,
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
    return { servers: authority.configured(), selected: staged ? staged.tools : null };
  } catch (error) {
    if (!(error instanceof McpAdapterMissing)) throw error;
    ctx.log.warn('MCP freeze degraded: adapter is unavailable.', {
      taskId: deps.taskId,
      error: errorMessage(error),
    });
    deps.audit({ taskId: deps.taskId, runId: run.id, mcpRevision: null, mcpDegraded: true });
    return null;
  }
}
