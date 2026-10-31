import { errorMessage } from '@atd/agent-contracts';
import type {
  createReadToolDefinition,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { resolveToolPath } from '../service-fs.js';
import { branchOf } from './branch.js';
import { runViewCall, type ViewCall } from './call.js';
import { readRange, readWindow, unchangedRead } from './reread.js';
import { recordRead, retainViews, type ViewRole, type ViewSession } from './ledger.js';
import { assertWritable, changedNote } from './stale.js';

type ReadTool = ReturnType<typeof createReadToolDefinition>;

/**
 * pi's write description with the rule this service adds (stale.ts): overwriting a file takes a
 * read of its current version first. pi's prompt snippet and guidelines stay as they are.
 */
export const WRITE_DESCRIPTION =
  "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories. To overwrite an existing file, read it in this conversation first; if it changed after your last read (a subagent, a command, an app or the user changed it), read it again before overwriting. Writing to a new path needs no read.";

/** Whose file tools a `FileViews` follows: a task's parent session, or one subagent child. */
export interface FileViewOwner {
  taskId: string;
  role: ViewRole;
  /** The session's id for a call without pi's context (pi passes one to every registered tool). */
  sessionId: () => string;
}

/** How many calls of each kind are remembered at once; ids are dropped as their calls end. */
const MAX_TRACKED = 512;

/** The tools these hooks wrap, the only calls whose ids they need to remember. */
const FILE_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit']);

/**
 * The File View Ledger's hooks into one session's read, write and edit tools, the same for the
 * parent and for every child: each call runs as a `ViewCall` (call.ts) that pi's operations see,
 * a read records the version it returned and what it showed, an edit reports a file that changed
 * since the session's view (stale.ts), and a repeated read of unchanged lines answers with a stub
 * (reread.ts). The write and edit operations themselves (tool-proxies.ts) check and record writes.
 */
export class FileViews {
  /** Calls a tool made (a codemode script's), by id, with the model-issued call that made them. */
  private readonly nested = new Map<string, string>();
  /**
   * Calls the model issued itself, as pi announced them. Only these may answer with a stub, so a
   * call missing from both records (dropped over the bound) reads in full: a script's read never
   * gets a stub in place of the text it asked for.
   */
  private readonly issued = new Set<string>();

  constructor(private readonly owner: FileViewOwner) {}

  /**
   * Follows the session's file tool calls as pi announces them before they run, telling the
   * model's own from those another tool made (pi marks these with `parentToolCallId`), and keeps
   * its views to its current branch whenever the session starts or moves its branch.
   */
  register(pi: Pick<ExtensionAPI, 'on'>): void {
    pi.on('tool_call', (event) => {
      if (!FILE_TOOLS.has(event.toolName)) return undefined;
      if (event.parentToolCallId) this.nested.set(event.toolCallId, event.parentToolCallId);
      else this.issued.add(event.toolCallId);
      bound(this.nested);
      bound(this.issued);
      return undefined;
    });
    const retain = (_event: unknown, ctx: ExtensionContext) =>
      retainViews(this.session(ctx), branchCalls(ctx.sessionManager));
    pi.on('session_start', retain);
    pi.on('session_tree', retain);
  }

  /** The session a call runs in. */
  session(ctx: Pick<ExtensionContext, 'sessionManager'> | undefined): ViewSession {
    const id = ctx?.sessionManager.getSessionId() ?? this.owner.sessionId();
    return { taskId: this.owner.taskId, id, role: this.owner.role };
  }

  /** Refuses a write over a file the session did not see as it is now (stale.ts). */
  assertWritable(
    ctx: Pick<ExtensionContext, 'sessionManager' | 'cwd'>,
    real: string,
    shown: string,
  ): Promise<void> {
    return assertWritable({ session: this.session(ctx), shown, branch: branchOf(ctx) }, real);
  }

  /**
   * pi's read, recording what each call saw. A call the model made itself may answer with a stub;
   * `resolve` gives the real path the call reads, as its operations confine it.
   */
  read(tool: ReadTool, cwd: string, resolve: (target: string) => Promise<string>): ReadTool {
    return {
      ...tool,
      execute: async (id, args, signal, onUpdate, ctx) => {
        const script = this.nested.get(id);
        const issued = script === undefined && this.issued.has(id);
        const call = this.call('read', id, args.path, ctx, script);
        try {
          if (issued) {
            const real = await resolve(resolveToolPath(ctx.cwd || cwd, args.path));
            const unchanged = await unchangedRead(call.session, real, args, ctx.sessionManager);
            if (unchanged) return unchanged;
          }
          const result = await runViewCall(call, () =>
            tool.execute(id, args, signal, onUpdate, ctx),
          );
          const seen = call.observed;
          if (seen?.version && !result.isError) {
            // Only a model-issued read shows the model its text; a script's goes to the script.
            const window = issued ? readWindow(args) : null;
            const range = window && readRange(window, result, id);
            recordRead(call.session, seen.real, seen.version, call.anchor, range);
          }
          return result;
        } finally {
          this.forget(id);
        }
      },
    };
  }

  /**
   * The edit tool (file-tools/edit-tool.ts), adding a note when the file changed since the
   * session's last view of it. The note goes first: the edit's own result and errors end with
   * the file's lines as raw text, which a note after them would read as part of.
   */
  edit<T extends TSchema, D, S>(tool: ToolDefinition<T, D, S>): ToolDefinition<T, D, S> {
    return {
      ...tool,
      execute: async (id, args, signal, onUpdate, ctx) => {
        const call = this.call('edit', id, pathOf(args), ctx, this.nested.get(id));
        try {
          const result = await runViewCall(call, () =>
            tool.execute(id, args, signal, onUpdate, ctx),
          );
          const note = noteOf(call, result.isError ? 'failed' : 'applied');
          return note
            ? { ...result, content: [{ type: 'text', text: note }, ...result.content] }
            : result;
        } catch (error) {
          const note = noteOf(call, 'failed');
          throw note ? new Error(`${note}\n${errorMessage(error)}`) : error;
        } finally {
          this.forget(id);
        }
      },
    };
  }

  /** pi's write with the read-first rule in its description; its operations enforce it. */
  write<T extends TSchema, D, S>(tool: ToolDefinition<T, D, S>): ToolDefinition<T, D, S> {
    return {
      ...tool,
      description: WRITE_DESCRIPTION,
      execute: async (id, args, signal, onUpdate, ctx) => {
        const call = this.call('write', id, pathOf(args), ctx, this.nested.get(id));
        try {
          return await runViewCall(call, () => tool.execute(id, args, signal, onUpdate, ctx));
        } finally {
          this.forget(id);
        }
      },
    };
  }

  /** Drops what was remembered of a call once it ended. */
  private forget(id: string): void {
    this.nested.delete(id);
    this.issued.delete(id);
  }

  private call(
    tool: ViewCall['tool'],
    id: string,
    shown: string,
    ctx: Pick<ExtensionContext, 'sessionManager' | 'cwd'>,
    script: string | undefined,
  ): ViewCall {
    const session = this.session(ctx);
    return { session, tool, anchor: script ?? id, shown, branch: branchOf(ctx) };
  }
}

/** The edit's note about a file that changed since the session's view, or null (stale.ts). */
function noteOf(call: ViewCall, outcome: 'applied' | 'failed'): string | null {
  return call.observed ? changedNote(call.session, call.observed, call.shown, outcome) : null;
}

/** Drops the oldest entries of `ids` over `MAX_TRACKED`. */
function bound(ids: Map<string, string> | Set<string>): void {
  for (const oldest of ids.keys()) {
    if (ids.size <= MAX_TRACKED) break;
    ids.delete(oldest);
  }
}

/** The ids of the tool results on the session's current branch. */
function branchCalls(sessions: ExtensionContext['sessionManager']): Set<string> {
  const ids = new Set<string>();
  for (const entry of sessions.getBranch())
    if (entry.type === 'message' && entry.message.role === 'toolResult')
      ids.add(entry.message.toolCallId);
  return ids;
}

/** The file path a file tool call names; empty when it names none. */
export function pathOf(args: unknown): string {
  const value = (args as { path?: unknown } | null)?.path;
  return typeof value === 'string' ? value : '';
}
