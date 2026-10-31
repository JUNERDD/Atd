import path from 'node:path';
import type { TSchema } from 'typebox';
import type { ExtensionFactory, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { inGrantedFolder } from '../folders/access.js';
import type { RunMaterial, SessionFactoryDeps } from '../pi-session.js';
import { ResourceStore, type TaskResources } from '../resources.js';
import { resourceIdAt, userAgentsReadRoots, withinRoots } from '../service-fs.js';
import { loadedSkillDirs } from '../skills/load-skill-tool.js';
import type { RunnerContext } from '../task-runner.js';
import type { HarnessDeps } from './deps.js';
import { resolveRoots } from './search/confine.js';
import {
  pathArgument,
  precheckSearch,
  searchCall,
  searchDefinitions,
  type SearchRun,
} from './search/tools.js';

/** What the search tools use of the harness deps: the task, its current run and the gate. */
export type SearchToolsDeps = Pick<HarnessDeps, 'cwd' | 'gate' | 'sessions'> & {
  runner: Pick<SessionFactoryDeps, 'taskId' | 'currentRunId' | 'currentMaterial' | 'audit'> & {
    ctx: Pick<RunnerContext, 'ledger' | 'paths'>;
  };
};

/** The run's read-only material a call reaches without a confirmation, as `read` reaches it. */
interface OwnMaterial {
  kind: 'skill' | 'resource' | 'folder';
  /** A resource's file: the one path of the resource store the call may reach. */
  file?: string;
}

/**
 * grep / find / ls: pi's built-in tools with confined pluggable operations. The names are
 * snapshot tools, so these registrations must exist whenever the binding allows them: they
 * shadow pi's own unconfined built-ins. Every call is confined to the task folder, `~/.agents`
 * with its linked skills (userAgentsReadRoots), the folders granted to the task as the current
 * run started, the directories of the run's skills, or a resource of the task (an attachment or
 * kept output); a path elsewhere, another task's resources among them, throws before the gate.
 * A task-folder call passes the gate as `read:inside`, which no tier prompts for but every call is
 * audited under; a `~/.agents` call as `read:outside`, like a read there. The run's own material
 * (skills, the task's resources, granted folders) skips the gate exactly as the read tool does
 * (tool-proxies.ts `ownMaterial`) and is audited as `<tool>:<kind>`. Children keep the task
 * folder only (search/tools.ts).
 */
export function searchToolsExtension(deps: SearchToolsDeps): ExtensionFactory {
  const resources = new ResourceStore(deps.runner.ctx.ledger, deps.runner.ctx.paths).forTask(
    deps.runner.taskId,
  );
  const tools = searchDefinitions(deps.cwd);
  return (pi) => {
    pi.registerTool(gated(tools.grep, deps, resources, (call, args) => call.grep(args)));
    pi.registerTool(gated(tools.find, deps, resources, (call, args, id) => call.find(id, args)));
    pi.registerTool(gated(tools.ls, deps, resources, (call, args, id) => call.ls(id, args)));
  };
}

function gated<T extends TSchema, D>(
  tool: ToolDefinition<T, D>,
  deps: SearchToolsDeps,
  resources: TaskResources,
  run: SearchRun<Parameters<ToolDefinition<T, D>['execute']>[1], D>,
): ToolDefinition<T, D> {
  return {
    ...tool,
    async execute(id, args, signal) {
      signal?.throwIfAborted();
      const material = deps.runner.currentMaterial();
      const folders = material.folders.map((folder) => folder.path);
      const skills = runSkillDirs(material, deps.sessions);
      const target = pathArgument(args) || '.';
      // Searches recurse, so a path that holds the data dir keeps the gate (folders/access.ts).
      const own = await ownMaterial(deps, resources, target, { folders, skills }, tool.name);
      // The call's roots, resolved once: every path its operations touch is checked against them.
      const roots = await resolveRoots(deps.cwd, [
        ...(await userAgentsReadRoots()),
        ...folders,
        ...skills,
        ...(own?.file ? [own.file] : []),
      ]);
      const location = await precheckSearch(roots, deps.cwd, tool.name, args);
      const base = {
        taskId: deps.runner.taskId,
        runId: deps.runner.currentRunId(),
        toolCallId: id,
      };
      if (own) deps.runner.audit({ ...base, tool: `${tool.name}:${own.kind}`, decision: own.kind });
      else
        await deps.gate({
          toolCallId: id,
          scope: { tool: 'read', location },
          title: `${tool.name}: ${(pathArgument(args) ?? '.').slice(0, 300)}`,
          detail: JSON.stringify({ tool: tool.name, args }),
          signal: signal ?? undefined,
        });
      // pi's context is not needed: these tools resolve paths against `deps.cwd`, its cwd.
      return run(searchCall(deps.cwd, roots, signal), args, id);
    },
  };
}

/**
 * The directories of the current run's skills: those selected for it and catalog skills its
 * context carries (a `load_skill` result), as pi-session.ts gives them to the read tool.
 */
function runSkillDirs(material: RunMaterial, sessions: SearchToolsDeps['sessions']): string[] {
  return [
    ...material.skills.map((skill) => skill.baseDir),
    ...loadedSkillDirs(material.catalog, sessions.buildContextEntries()),
  ];
}

/** Which of the run's own material `target` is in, checked in the read tool's order. */
async function ownMaterial(
  deps: SearchToolsDeps,
  resources: TaskResources,
  target: string,
  run: { folders: readonly string[]; skills: readonly string[] },
  tool: string,
): Promise<OwnMaterial | null> {
  if (await withinRoots(run.skills, deps.cwd, target)) return { kind: 'skill' };
  const id = await resourceIdAt(resources.dir, deps.cwd, target);
  if (id !== null && resources.owns(id))
    return { kind: 'resource', file: path.join(resources.dir, id) };
  const dataDir = deps.runner.ctx.paths.root;
  return (await inGrantedFolder(run.folders, dataDir, deps.cwd, target, tool !== 'ls'))
    ? { kind: 'folder' }
    : null;
}
