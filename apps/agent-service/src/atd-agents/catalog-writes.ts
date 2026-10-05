import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIRM_DETAIL_CHARS, type Gate } from '../harness/gate.js';
import { atdAgentsDir, confinedWrite, realInside } from '../service-fs.js';
import { agentHarnessFile } from './harness.js';

/**
 * Writes by the parent's write and edit tools that change the subagents later runs register: a
 * file in the Personal agent catalog (`<atdHome>/agents`), which every later run registers without
 * an `@` reference (run-agents.ts), and the harness file of Settings switches and permission
 * overrides (harness.ts). Each such write asks the user with the file's whole new content,
 * whatever the task's tier, a session grant or the `auto` review would allow. The confirm sits in
 * the write operation, where pi has resolved the path and, for an edit, computed the bytes it
 * writes; the folders a new catalog file needs are made only once it is approved. Subagent
 * children never write outside their task folder (subagents/child-tools.ts), and the catalog
 * loader skips a file that links out of the catalog or has another hard link (catalog.ts), since
 * writes through those paths would not reach this confirm.
 *
 * Known gaps: bash, whose shell policy decides which commands run, not which files they write;
 * the file tools of MCP servers, which write from their own processes under the MCP approval
 * only; and saved commands, which later runs follow as well but whose saves the gate confirms
 * under the task's tier like any other call (commands/tool.ts).
 */

/** The parent tool call a file or shell operation runs in (tool-proxies.ts). */
export interface WriteCall {
  toolCallId: string;
  signal: AbortSignal | undefined;
  /**
   * The call's path is a catalog target, so its ordinary approval was left to the confirm here;
   * a write that then lands anywhere else is refused rather than written unapproved.
   */
  catalogWrite: boolean;
}

/** What a parent write operation needs; `call` answers the call it runs in. */
export interface CatalogWriteHost {
  tool: 'write' | 'edit';
  cwd: string;
  dataDir: string;
  gate: Gate;
  call: () => WriteCall;
}

/** Which catalog file a write changes. */
type CatalogTarget = 'agent' | 'settings';

/** What a write at the resolved path `real` changes in the subagent catalog; null for others. */
export async function catalogTarget(dataDir: string, real: string): Promise<CatalogTarget | null> {
  if (await realInside(atdAgentsDir(), real)) return 'agent';
  if (await realInside(agentHarnessFile(dataDir), real)) return 'settings';
  return null;
}

/** The lines above the content the user approves: the file and what it changes. */
function heading(target: CatalogTarget, real: string): string {
  return target === 'agent'
    ? `Subagent file: ${real}\nLater tasks can delegate to the subagent it defines.`
    : `Subagent settings: ${real}\nThis file sets which subagents later tasks register, and their permissions.`;
}

/**
 * The write step of one parent file tool (tool-proxies.ts `WriteResolved`): pi's operations hand
 * it the real path and the exact bytes. Throws, writing nothing, when the user declines.
 */
export function catalogConfirmedWrite(
  host: CatalogWriteHost,
): (real: string, content: string) => Promise<void> {
  return async (real, content) => {
    const call = host.call();
    const target = await catalogTarget(host.dataDir, real);
    if (target) {
      const detail = `${heading(target, real)} Its new content:\n\n${content}`;
      // The user approves exactly what is written, so content the confirm would cut is refused.
      if (detail.length > CONFIRM_DETAIL_CHARS)
        throw new Error(
          'The new content is too large to show for approval, so nothing was written.',
        );
      const { location } = await confinedWrite(host.cwd, host.dataDir, real);
      await host.gate({
        toolCallId: call.toolCallId,
        scope: { tool: host.tool, location },
        title: `Save the ${target === 'agent' ? 'subagent file' : 'subagent settings'} ${real.slice(0, 300)}`,
        detail,
        signal: call.signal,
        askAlways: true,
      });
      // pi's folder step left them (`catalogDeferredFolders`); the harness file's folder exists.
      if (target === 'agent') await mkdir(path.dirname(real), { recursive: true });
    } else if (call.catalogWrite) {
      throw new Error(
        'The path resolved to another location during the call, so nothing was written.',
      );
    }
    await writeFile(real, content);
  };
}

/**
 * pi's folder step for the parent's write tool (tool-proxies.ts `writeOperations`): folders at a
 * catalog target wait for the confirmed write above, so a declined write leaves none behind.
 */
export function catalogDeferredFolders(dataDir: string): (real: string) => Promise<void> {
  return async (real) => {
    if (!(await catalogTarget(dataDir, real))) await mkdir(real, { recursive: true });
  };
}
