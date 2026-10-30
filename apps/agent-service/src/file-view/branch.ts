import { realpath } from 'node:fs/promises';
import type { ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { resolveToolPath } from '../service-fs.js';

/**
 * What a session's own transcript shows it saw of a file, for a write over a file the File View
 * Ledger holds no view of. The ledger lives in memory, so a service restart clears it and its
 * bounds drop tasks and views, while the session's current branch keeps every read, write and
 * edit the model issued, each result with the time it came back.
 */
export interface SessionBranch {
  /** The session's current branch, root first (pi's `SessionManager.getBranch`). */
  entries: () => readonly SessionEntry[];
  /** The directory the session's file tools resolve a relative `path` against. */
  cwd: string;
}

/** The branch of the session a tool call runs in. */
export function branchOf(ctx: Pick<ExtensionContext, 'sessionManager' | 'cwd'>): SessionBranch {
  return { entries: () => ctx.sessionManager.getBranch(), cwd: ctx.cwd };
}

const FILE_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit']);

/** A file tool call the model issued: the path it named, and when its message's response ended. */
interface IssuedCall {
  path: string;
  /** No call of the message ran before this time. */
  issued: number;
  /** Whether it was its message's only tool call, so its result came back as soon as it ran. */
  alone: boolean;
}

/**
 * Whether the branch holds a successful read, write or edit of the file at `real` that came back
 * after the file's last modification (`modifiedNs`), so what that call saw is the file as it is
 * now. A write's or an edit's result time counts: the call made a modification itself, and the
 * parent runs write and edit one call at a time (file-tool-gate.ts), each result recorded as soon
 * as its call ran. A read among other calls of its message may have run in parallel with them, and
 * pi records a parallel batch's results only once its last call ends, by which time the file may
 * have changed again: such a read counts from when its message ended, before any of its calls ran.
 * Times compare in milliseconds, the precision of result times, and a call names the file when its
 * path resolves to the same real path now.
 */
export async function sawCurrent(
  branch: SessionBranch,
  real: string,
  modifiedNs: bigint,
): Promise<boolean> {
  const modified = Number(modifiedNs / 1_000_000n);
  const calls = new Map<string, IssuedCall>();
  const seen: string[] = [];
  for (const entry of branch.entries()) {
    if (entry.type !== 'message') continue;
    const { message } = entry;
    if (message.role === 'assistant') {
      const toolCalls = message.content.filter((block) => block.type === 'toolCall');
      const issued = message.timestamp + (message.durationMs ?? 0);
      for (const call of toolCalls) {
        const { path } = call.arguments;
        if (FILE_TOOLS.has(call.name) && typeof path === 'string')
          calls.set(call.id, { path, issued, alone: toolCalls.length === 1 });
      }
    } else if (message.role === 'toolResult' && !message.isError) {
      const call = calls.get(message.toolCallId);
      if (!call) continue;
      const at = message.toolName === 'read' && !call.alone ? call.issued : message.timestamp;
      if (at >= modified) seen.push(call.path);
    }
  }
  const resolved = new Set<string>();
  for (const path of seen.toReversed()) {
    const target = resolveToolPath(branch.cwd, path);
    if (resolved.has(target)) continue;
    resolved.add(target);
    if ((await realpath(target).catch(() => null)) === real) return true;
  }
  return false;
}
