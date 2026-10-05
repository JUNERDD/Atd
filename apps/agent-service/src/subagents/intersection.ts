import { MEMORY_READ_TOOLS, WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from '@atd/agent-contracts';
import { confined, confinedWrite } from '../service-fs.js';
import { FORBIDDEN_CHILD_TOOLS } from './config.js';

/**
 * T5 capability intersection. Child names come from parent ∩ role ∩
 * revocation; Skill/MCP annotations and profile text are never consulted.
 * Name ceilings never replace path/connection/operation/resource checks.
 */

export interface IntersectionInput {
  parentTools: string[];
  roleAllowsTools: string[];
  revokedTools: string[];
  /**
   * The run's frozen MCP tools (pi-session-mcp.ts `SessionMcpPrep.tools`): its proxies
   * (`mcp__<server>__<tool>`), and the resource tools and `tool_search` when it bound them.
   */
  mcpTools: readonly string[];
  /** Whether the run snapshot enables memory, and with it the memory read tools. */
  runMemory: boolean;
}

export interface IntersectionResult {
  /** Exact child tool allowlist for the capability ceiling. */
  allowedTools: string[];
  removedTools: string[];
}

/**
 * Service tools a child may inherit; ask/desktop/subagent never pass. grep/find/ls are
 * read-only and confined to the task folder like the parent's.
 */
const CHILD_ELIGIBLE_SERVICE_TOOLS = new Set([
  'read',
  'write',
  'edit',
  'bash',
  'command',
  'grep',
  'find',
  'ls',
]);

/**
 * Parent service tools a child inherits although neither the snapshot nor a role names them:
 * every parent run keeps the web tools (run-binding.ts), and a child's calls pass the same `web`
 * gate as the parent's (subagents/child-tools.ts).
 */
export const CHILD_WEB_TOOLS: readonly string[] = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];

const FORBIDDEN = new Set<string>(FORBIDDEN_CHILD_TOOLS);

/**
 * Intersects parent tools with role allows minus revocation, then narrows to
 * child-eligible service tools plus the run's MCP tools, the memory read tools and web.
 */
export function intersectChildTools(input: IntersectionInput): IntersectionResult {
  const allow = new Set(input.roleAllowsTools);
  const revoked = new Set(input.revokedTools);
  const mcp = new Set(input.mcpTools);
  const allowed: string[] = [];
  const removed: string[] = [];
  const candidates = [...input.parentTools, ...input.mcpTools, ...CHILD_WEB_TOOLS];
  if (input.runMemory) candidates.push(...MEMORY_READ_TOOLS);
  for (const tool of new Set(candidates)) {
    if (FORBIDDEN.has(tool)) {
      removed.push(tool);
      continue;
    }
    // MCP tools, the memory read tools and web come from the run itself, not from a role grant.
    const inherited =
      mcp.has(tool) || MEMORY_READ_TOOLS.includes(tool) || CHILD_WEB_TOOLS.includes(tool);
    if (!inherited && !CHILD_ELIGIBLE_SERVICE_TOOLS.has(tool)) {
      removed.push(tool);
      continue;
    }
    if (!inherited && !allow.has(tool)) {
      removed.push(tool);
      continue;
    }
    if (revoked.has(tool)) {
      removed.push(tool);
      continue;
    }
    allowed.push(tool);
  }
  return { allowedTools: allowed.sort(), removedTools: removed.sort() };
}

/** True when a tool name survives the child ceiling. */
export function isChildToolAllowed(allowedTools: string[], tool: string): boolean {
  return allowedTools.includes(tool);
}

/** Child file check: confined to the service dataDir, inside reported; writes skip protected roots. */
export async function checkChildPath(input: {
  cwd: string;
  dataDir: string;
  rawPath: string;
  write?: boolean;
}): Promise<{ real: string; location: 'inside' | 'outside' }> {
  return input.write
    ? confinedWrite(input.cwd, input.dataDir, input.rawPath)
    : confined(input.cwd, input.dataDir, input.rawPath);
}

/** Child resource check: ledger-owned ids only, never bare filesystem paths. */
export function checkChildResource(input: {
  resourceId: string;
  knownIds: Set<string>;
}): { ok: true } | { ok: false; reason: string } {
  if (!/^[a-zA-Z0-9_-]+$/.test(input.resourceId))
    return { ok: false, reason: 'Resource id is malformed.' };
  if (!input.knownIds.has(input.resourceId))
    return { ok: false, reason: `Resource ${input.resourceId} is not in the ledger.` };
  return { ok: true };
}

/** Child agents stay within the service runtime set; packaged names refused. */
export function checkChildAgent(
  agent: string,
  allowedAgents: string[],
):
  | {
      ok: true;
    }
  | { ok: false; reason: string } {
  if (allowedAgents.includes(agent)) return { ok: true };
  return { ok: false, reason: `Agent ${agent} is not in the service allowlist.` };
}
