import {
  COMPUTER_TOOL,
  LOAD_SKILL_TOOL,
  MEMORY_READ_TOOLS,
  TODO_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type RunSnapshot,
} from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';

/**
 * Snapshot file tools an unattended computer run keeps: reading, and `write`/`edit`, which such a
 * run may only point at its task output directory (tool-proxies.ts `writesInsideOnly`).
 */
const FILE_TOOLS: ReadonlySet<string> = new Set(['read', 'grep', 'find', 'ls', 'write', 'edit']);

/** The product skill that teaches the `computer` tool. */
const COMPUTER_SKILL = 'computer-use';

/**
 * Attended runs always keep the tool and its setup guidance. Targets and installed engines are
 * checked live by the calls, so installing the browser engine does not require a new model
 * session. Unattended runs retain their frozen scope and require an installed engine at
 * preparation (the app engine is built in; the browser engine is an add-on).
 */
export function computerToolFor(
  snapshot: RunSnapshot,
  computer: { hasEngineFor(bindingIds: readonly string[]): boolean },
): boolean {
  return (
    snapshot.trigger === undefined ||
    (snapshot.computer !== undefined && computer.hasEngineFor(snapshot.computer.bindingIds))
  );
}

/** Product skills a run's catalog leaves out because they teach a tool the run lacks. */
export function withheldSkills(computer: boolean): ReadonlySet<string> {
  return new Set(computer ? [] : [COMPUTER_SKILL]);
}

/**
 * Whether a run is an unattended computer run: an automation started it with computer use. Such a
 * run gets the exact tool set of `restrictedComputerTools`, never the parent's usual one.
 */
export function isRestrictedComputerRun(snapshot: RunSnapshot): boolean {
  return snapshot.trigger !== undefined && snapshot.computer !== undefined;
}

/** `isRestrictedComputerRun` for the ledger's current run of a task, asked per call. */
export function restrictedComputerRunOf(ledger: Ledger, taskId: string, runId: string): boolean {
  const task = ledger.data.tasks.find((item) => item.id === taskId);
  const run = task?.runs.find((item) => item.id === runId);
  return run !== undefined && isRestrictedComputerRun(run.snapshot);
}

/**
 * The exact allowlist of an unattended computer run (D5, plan §6.2): `computer` (while one of its
 * targets' engines is installed, `computerToolFor`), the snapshot's
 * read-only file tools and its write and edit (confined to the output directory), the web reads,
 * memory reads when the run reads memory, `load_skill` when the catalog has a loadable skill, and
 * the two tools that only answer or record (`ask_user` answers that nobody is present, `todo`
 * keeps the run's own list). No bash, command, MCP, app, automation, subagent, codemode, desktop
 * or MCP configuration: whatever pi or an extension registers beyond this list, pi drops.
 */
export function restrictedComputerTools(
  snapshot: RunSnapshot,
  options: { loadable: boolean; computer: boolean },
): string[] {
  return [
    ...new Set([
      ...(options.computer ? [COMPUTER_TOOL] : []),
      ...snapshot.tools.filter((tool) => FILE_TOOLS.has(tool)),
      WEB_SEARCH_TOOL,
      WEB_FETCH_TOOL,
      'ask_user',
      TODO_TOOL,
      ...(snapshot.memory ? MEMORY_READ_TOOLS : []),
      ...(options.loadable ? [LOAD_SKILL_TOOL] : []),
    ]),
  ];
}
