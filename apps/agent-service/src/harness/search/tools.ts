import type { Static, TSchema } from 'typebox';
import {
  createFindTool,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsTool,
  createLsToolDefinition,
  type AgentToolResult,
  type FindToolDetails,
  type FindToolInput,
  type GrepToolDetails,
  type GrepToolInput,
  type LsToolDetails,
  type LsToolInput,
} from '@earendil-works/pi-coding-agent';
import { parse } from '@atd/agent-contracts';
import { realAncestorPath, resolveToolPath } from '../../service-fs.js';
import type { ChildTool } from '../../subagents/child-tools.js';
import {
  confineToolArgument,
  resolveRoots,
  searchOperations,
  type SearchRoots,
} from './confine.js';
import { runGrep } from './grep.js';
import { resolveRipgrep } from './ripgrep.js';

/** The read-only search tools: pi's built-ins, confined to the task folder and the call's roots. */
export const SEARCH_TOOL_NAMES = ['grep', 'find', 'ls'] as const;

const SKIPPED =
  'Skips .git and node_modules below the searched path; name one as the path to search it.';

/**
 * The three tools as registered: pi's definitions (schema, renderers, prompt snippet), whose
 * `execute` the caller replaces with a call of `searchCall`, so these never run with their own
 * operations. grep and find also tell the model what every rg call skips (ripgrep.ts).
 */
export function searchDefinitions(cwd: string): {
  grep: ReturnType<typeof createGrepToolDefinition>;
  find: ReturnType<typeof createFindToolDefinition>;
  ls: ReturnType<typeof createLsToolDefinition>;
} {
  const grep = createGrepToolDefinition(cwd);
  const find = createFindToolDefinition(cwd);
  return {
    grep: { ...grep, description: `${grep.description} ${SKIPPED}` },
    find: { ...find, description: `${find.description} ${SKIPPED}` },
    ls: createLsToolDefinition(cwd),
  };
}

/** One call's grep, find and ls, each running on operations confined to that call's roots. */
export interface SearchCall {
  grep(params: GrepToolInput): Promise<AgentToolResult<GrepToolDetails | undefined>>;
  find(id: string, params: FindToolInput): Promise<AgentToolResult<FindToolDetails | undefined>>;
  ls(id: string, params: LsToolInput): Promise<AgentToolResult<LsToolDetails | undefined>>;
}

/**
 * The tools of one checked call on `roots`, with its abort `signal`: grep on the service's ripgrep
 * (grep.ts), find and ls as pi's tools built for this call. They take no pi context: pi resolves
 * their paths against the context's cwd, which is `cwd`. find's limit notice gets pi's
 * `Use limit=` hint, which pi's custom-glob path leaves out.
 */
export function searchCall(cwd: string, roots: SearchRoots, signal?: AbortSignal): SearchCall {
  const operations = searchOperations(roots, signal);
  const find = createFindTool(cwd, { operations: operations.find });
  const ls = createLsTool(cwd, { operations: operations.ls });
  return {
    grep: (params) => runGrep(cwd, operations.grep, params, signal),
    find: async (id, params) => withLimitHint(await find.execute(id, params, signal)),
    ls: (id, params) => ls.execute(id, params, signal),
  };
}

function withLimitHint<D>(result: AgentToolResult<D>): AgentToolResult<D> {
  const details: unknown = result.details;
  const limit =
    details && typeof details === 'object' && 'resultLimitReached' in details
      ? details.resultLimitReached
      : undefined;
  if (typeof limit !== 'number') return result;
  const notice = `[${limit} results limit reached`;
  const hinted = `${notice}. Use limit=${limit * 2} for more, or refine pattern`;
  const content = result.content.map((part) =>
    part.type === 'text' ? { ...part, text: part.text.replace(notice, hinted) } : part,
  );
  return { ...result, content };
}

/**
 * Checks a grep/find/ls call before the gate, for parent and child alike: the `path` argument
 * must resolve inside the call's `roots`, and grep/find need `rg` on PATH. Answers where the path
 * landed, the gate scope.
 */
export async function precheckSearch(
  roots: SearchRoots,
  cwd: string,
  name: string,
  args: unknown,
): Promise<'inside' | 'outside'> {
  const location = await confineToolArgument(roots, cwd, pathArgument(args));
  if (name === 'grep' || name === 'find') await resolveRipgrep();
  return location;
}

/** The call's `path` argument; pi's schemas make it an optional string. */
export function pathArgument(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || !('path' in args)) return undefined;
  return typeof args.path === 'string' ? args.path : undefined;
}

/** How one tool runs within a call: the call's tools, its checked arguments `A` and its id. */
export type SearchRun<A, D = unknown> = (
  call: SearchCall,
  args: A,
  id: string,
) => Promise<AgentToolResult<D>>;

/**
 * The roots one child call may reach besides the task folder, by the real path its `path`
 * argument names: only places the child may already read without a confirmation (child-tools.ts).
 */
export type ChildRoots = (real: string) => Promise<readonly string[]>;

/** What a child's search calls are confined to and audited by. */
interface ChildSearch {
  root: string;
  extraRoots: ChildRoots;
  audit: (tool: string) => void;
}

/**
 * Child registrations of grep/find/ls: the same tools, operations and confinement as the parent,
 * to the task folder and each call's `extraRoots`. Children have no confirm path, and these calls
 * need none: a task-folder call is `read:inside`, which every tier allows, and an extra root holds
 * only what the child may already read, so the child audits the call and runs it.
 */
export function childSearchTools(
  root: string,
  allowed: readonly string[],
  audit: (tool: string) => void,
  extraRoots: ChildRoots,
): ChildTool[] {
  const tools = searchDefinitions(root);
  const search: ChildSearch = { root, extraRoots, audit };
  return [
    child(tools.grep, search, (call, args) => call.grep(args)),
    child(tools.find, search, (call, args, id) => call.find(id, args)),
    child(tools.ls, search, (call, args, id) => call.ls(id, args)),
  ].filter((tool) => allowed.includes(tool.name));
}

function child<T extends TSchema>(
  tool: { name: string; label: string; description: string; parameters: T },
  { root, extraRoots, audit }: ChildSearch,
  run: SearchRun<Static<T>>,
): ChildTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(id, args, signal) {
      signal?.throwIfAborted();
      const params = parse(tool.parameters, args);
      // The path as pi resolves it, real through every link, as the confinement compares it.
      const target = await realAncestorPath(resolveToolPath(root, pathArgument(params) || '.'));
      const roots = await resolveRoots(root, await extraRoots(target));
      await precheckSearch(roots, root, tool.name, params);
      audit(tool.name);
      const result = await run(searchCall(root, roots, signal), params, id);
      const content = result.content.flatMap((part) =>
        part.type === 'text' ? [{ type: 'text', text: part.text }] : [],
      );
      return { content, details: result.details ?? {} };
    },
  };
}
