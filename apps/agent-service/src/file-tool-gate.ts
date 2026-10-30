import type { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { catalogTarget, type WriteCall } from './atd-agents/catalog-writes.js';
import { catalogArtifactWrite } from './catalog-artifacts.js';
import { pathOf, type FileViews } from './file-view/tools.js';
import { inGrantedFolder } from './folders/access.js';
import type { Gate } from './harness/gate.js';
import {
  confined,
  confinedWrite,
  resolveToolPath,
  resourceIdAt,
  withinRoots,
  type ConfinedPath,
} from './service-fs.js';
import type { ServiceToolHost } from './tool-proxies.js';
import { auditWrote } from './unattended.js';

/** What the parent's file tool gate uses: the tool host, its gate, call store and file views. */
export interface FileToolGateDeps {
  host: ServiceToolHost;
  authorize: Gate;
  /** The tool call each file operation runs in (tool-proxies.ts `serviceTools`). */
  calls: AsyncLocalStorage<WriteCall>;
  views: FileViews;
  /** Roots only the read tool may reach beyond the data directory (service-fs.ts `confined`). */
  readRoots: () => Promise<string[]>;
  /** Whether write and edit may reach only the task output directory. */
  insideOnly: () => boolean;
}

/** Which file tool a call is; their gates differ. */
export type FileToolName = 'read' | 'write' | 'edit';

/**
 * The parent's gate around read, write and edit. A call's target is first confined exactly as its
 * operation confines it, so a path the operation would refuse fails before any prompt or review,
 * and the real path, through every link, decides the grant scope: a link in the task folder that
 * leads into the data dir asks as `outside`, while `/var` and `/private/var` spellings of the task
 * folder both stay `inside`. A confirm shows where such a link really leads. A read of the run's
 * own material (its skills, the task's resources, a granted folder) needs no confirmation; a write
 * over a file this conversation has not seen as it is now fails before any prompt too (stale.ts);
 * a catalog write leaves its confirm to its write step (atd-agents/catalog-writes.ts). Reads may
 * run in parallel; write and edit keep their batch in order.
 */
export function fileToolGate(deps: FileToolGateDeps) {
  const { host } = deps;

  /** Which of the run's own read-only material the real path `real` is in, if any. */
  async function ownMaterial(real: string): Promise<'skill' | 'resource' | 'folder' | null> {
    if (await withinRoots(host.skillDirs(), host.cwd, real)) return 'skill';
    const id = await resourceIdAt(host.taskResources.dir, host.cwd, real);
    if (id !== null && host.taskResources.owns(id)) return 'resource';
    const folders = host.folders();
    return (await inGrantedFolder(folders, host.dataDir, host.cwd, real, false)) ? 'folder' : null;
  }

  return function controlled<T extends TSchema, D, S>(
    tool: ToolDefinition<T, D, S>,
    name: FileToolName,
  ): ToolDefinition<T, D, S> {
    return {
      ...tool,
      ...(name === 'read' ? {} : { executionMode: 'sequential' as const }),
      async execute(id, args, signal, onUpdate, ctx) {
        signal?.throwIfAborted();
        const requested = resolveToolPath(host.cwd, pathOf(args));
        const target =
          name === 'read'
            ? await confined(host.cwd, host.dataDir, requested, await deps.readRoots())
            : await confinedWrite(host.cwd, host.dataDir, requested, deps.insideOnly());
        const own = name === 'read' ? await ownMaterial(target.real) : null;
        const base = { taskId: host.taskId, runId: host.runId(), toolCallId: id };
        if (name === 'write') await deps.views.assertWritable(ctx, target.real, pathOf(args));
        // A write that changes the subagent catalog is asked once, with its content, when written.
        const catalogWrite =
          name !== 'read' && (await catalogTarget(host.dataDir, target.real)) !== null;
        if (own) host.audit({ ...base, tool: `read:${own}`, decision: own });
        else if (!catalogWrite)
          await deps.authorize({
            toolCallId: id,
            scope: { tool: name, location: target.location },
            title: titleOf(name, args, requested, target),
            detail: detailOf(name, args, requested, target),
            signal: signal ?? undefined,
          });
        // Pi's tool context goes through untouched. It defines `tools` and `executeTool` as
        // non-enumerable properties, which a spread drops, and its `cwd` already is `host.cwd`:
        // pi-session.ts builds the session and these tools from the same task output directory.
        // A wrapper that needs another cwd must derive from the context, as in
        // `Object.create(ctx, { cwd: { value } })`, never spread it.
        const call: WriteCall = { toolCallId: id, signal: signal ?? undefined, catalogWrite };
        // A Personal skill or subagent it saves is recorded for the turn's artifact cards.
        const saves = name === 'read' ? null : await catalogArtifactWrite(target.real);
        const done = await deps.calls.run(call, () =>
          tool.execute(id, args, signal, onUpdate, ctx),
        );
        await saves?.record(host.sessions, id, host.dataDir);
        // What an unattended run wrote is audited, so its folder automation skips its own output.
        if (name !== 'read' && host.unattended())
          await auditWrote(host.audit, { ...base, tool: name, path: target.real });
        return done;
      },
    };
  };
}

/** The confirm title: the call and its path, and where a link makes that path really lead. */
function titleOf(name: string, args: unknown, requested: string, target: ConfinedPath): string {
  const shown = pathOf(args);
  if (!shown) return `${name} operation`;
  const real = target.real === requested ? '' : ` → ${target.real.slice(0, 300)}`;
  return `${name}: ${shown.slice(0, 300)}${real}`;
}

/** What the user (and the `auto` review) approves: the call, and the real target when it differs. */
function detailOf(name: string, args: unknown, requested: string, target: ConfinedPath): string {
  try {
    const real = target.real === requested ? {} : { target: target.real };
    return JSON.stringify({ tool: name, args, ...real });
  } catch {
    return name;
  }
}
