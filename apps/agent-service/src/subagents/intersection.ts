import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from '@ai/agent-contracts';
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
  /** Run-frozen MCP proxy names (`mcp__<server>__<tool>`). */
  mcpProxies: string[];
  /** Whether the run snapshot enables memory search. */
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
 * child-eligible service tools plus frozen MCP proxies, memory search and web.
 */
export function intersectChildTools(input: IntersectionInput): IntersectionResult {
  const allow = new Set(input.roleAllowsTools);
  const revoked = new Set(input.revokedTools);
  const proxies = new Set(input.mcpProxies);
  const allowed: string[] = [];
  const removed: string[] = [];
  const candidates = [...input.parentTools, ...input.mcpProxies, ...CHILD_WEB_TOOLS];
  if (input.runMemory) candidates.push('memory_search');
  for (const tool of new Set(candidates)) {
    if (FORBIDDEN.has(tool)) {
      removed.push(tool);
      continue;
    }
    // Proxies, memory search and web come from the run itself, not from a role grant.
    const inherited =
      proxies.has(tool) || tool === 'memory_search' || CHILD_WEB_TOOLS.includes(tool);
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

/** Child MCP check: frozen server/tool/URI only, revoked servers refused. */
export function checkChildMcpOperation(input: {
  serverId: string;
  toolOrUri: string;
  frozenServers: { serverId: string; revision: number; disabled: boolean }[];
}): { ok: true } | { ok: false; reason: string } {
  const record = input.frozenServers.find((entry) => entry.serverId === input.serverId);
  if (!record) return { ok: false, reason: `MCP server ${input.serverId} is not in the run.` };
  if (record.disabled) return { ok: false, reason: `MCP server ${input.serverId} is revoked.` };
  if (!input.toolOrUri) return { ok: false, reason: 'MCP operation is empty.' };
  return { ok: true };
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
