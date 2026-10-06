import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Ledger } from './ledger.js';

/**
 * Unattended runs. A run whose snapshot carries `trigger` (`RunSnapshot.trigger`) was started by
 * an automation, and nobody is present to answer for it. Every point that would wait for a person
 * answers at once instead, and each such answer appends one audit line with
 * `decision: 'unattended'` (`auditUnattended`), which the automation engine counts once the run
 * has ended to report that the run needs attention:
 *
 * - a guarded action its tier would confirm is declined (harness/gate.ts), and so is a guarded MCP
 *   tool call (pi-session-mcp.ts, mcp/approval.ts);
 * - `ask_user` hears that nobody is available (harness/ask-user.ts);
 * - the desktop and `configure_mcp` tools are unavailable (desktop-tool.ts, configure-mcp-tool.ts).
 *
 * Each file the run's write and edit tools change is recorded too (`decision: 'wrote'`,
 * `auditWrote`), so a folder automation never fires on its own run's output. The audit is complete
 * once the run's terminal status is published (task-runner.ts), when the engine reads it
 * (`readUnattendedAudit`).
 */

/** What an unattended answer stood in for: a confirm, a question, a desktop ability, an MCP edit. */
export type UnattendedKind = 'confirm' | 'question' | 'desktop' | 'mcpConfig';

/** The longest `title` an unattended audit line keeps. */
const TITLE_CHARS = 200;

/** The tool error of a guarded action an unattended run declined. */
export const UNATTENDED_DECLINED =
  'Nobody is present to approve this action, so it was not performed: an automation started this run without anyone watching. Continue without it if you can, and say in your answer what needed approval.';

/** `ask_user`'s answer in an unattended run. */
export const UNATTENDED_ANSWER =
  'Nobody is available to answer: an automation started this run without anyone present. Proceed with the most reasonable assumption and state that assumption in your answer.';

/** The desktop tool's error in an unattended run. */
export const UNATTENDED_DESKTOP =
  'Desktop abilities (file picker, save dialog, selection and clipboard) are unavailable in automation runs: nobody is at the desktop, so nothing was requested. Work without them.';

/** `configure_mcp`'s error in an unattended run. */
export const UNATTENDED_MCP_CONFIG =
  'MCP configuration is unavailable in automation runs: nobody is present to review a server change, so nothing was saved. Say in your answer which server change is needed.';

/**
 * The error of a guarded MCP tool call an unattended run refused. It never says "declined": the
 * proxy reports a declined call as the user's own decision (mcp/proxy-tool.ts).
 */
export function unattendedMcpCall(serverId: string, tool: string): string {
  return `Nobody is present to approve MCP tool ${tool} on ${serverId}, so it was not called: an automation started this run without anyone watching.`;
}

/**
 * Whether a run started without anyone present. Tools ask per call, through the run that is
 * current then: a task's runs share a session, and a person may follow up on an automation's task.
 * A run the ledger no longer lists (its task was deleted) counts as attended.
 */
export function isUnattendedRun(ledger: Ledger, taskId: string, runId: string): boolean {
  const task = ledger.data.tasks.find((item) => item.id === taskId);
  return task?.runs.find((run) => run.id === runId)?.snapshot.trigger !== undefined;
}

/** One unattended answer as its audit line records it; extra fields are kept. */
export interface UnattendedEntry {
  taskId: string;
  runId: string;
  tool: string;
  kind: UnattendedKind;
  /** What was asked for, in a few words (a confirm's title, the question, the ability). */
  title: string;
  [field: string]: unknown;
}

/** Appends the one audit line an unattended answer writes. */
export function auditUnattended(
  audit: (entry: Record<string, unknown>) => void,
  entry: UnattendedEntry,
): void {
  audit({ ...entry, decision: 'unattended', title: entry.title.slice(0, TITLE_CHARS) });
}

/** A file an unattended run's write or edit tool changed. */
export interface WroteEntry {
  taskId: string;
  runId: string;
  toolCallId: string;
  tool: 'write' | 'edit';
  /** The absolute path written; recorded as its real path, NFC-normalized. */
  path: string;
}

/**
 * Appends the line of a file an unattended run wrote. The path is resolved again now that the file
 * exists, so it carries the case and links as the disk has them, and is NFC-normalized like the
 * names a folder scan keeps.
 */
export async function auditWrote(
  audit: (entry: Record<string, unknown>) => void,
  entry: WroteEntry,
): Promise<void> {
  const real = await realpath(entry.path).catch(() => entry.path);
  audit({ ...entry, path: real.normalize('NFC'), decision: 'wrote' });
}

/** What an ended unattended run's audit recorded, as the automation engine reads it. */
export interface UnattendedAudit {
  /** Answers given in place of a person (`decision: 'unattended'`). */
  declined: number;
  /** Files its write and edit tools changed (`decision: 'wrote'`), absolute and NFC. */
  wrote: string[];
}

/** Reads a run's audit; a run without an audit file declined and wrote nothing. */
export async function readUnattendedAudit(
  auditDir: string,
  runId: string,
): Promise<UnattendedAudit> {
  const read: UnattendedAudit = { declined: 0, wrote: [] };
  let text: string;
  try {
    text = await readFile(path.join(auditDir, `${runId}.jsonl`), 'utf8');
  } catch {
    return read;
  }
  for (const line of text.split('\n')) {
    let entry: unknown;
    try {
      entry = line.trim() ? JSON.parse(line) : null;
    } catch {
      // A torn last line (the process died mid-append) records nothing.
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const decision: unknown = Reflect.get(entry, 'decision');
    const written: unknown = Reflect.get(entry, 'path');
    if (decision === 'unattended') read.declined += 1;
    else if (decision === 'wrote' && typeof written === 'string' && path.isAbsolute(written))
      read.wrote.push(written);
  }
  return read;
}
