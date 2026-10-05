import type {
  ExtensionFactory,
  ToolAnnotations,
  ToolExposure,
  ToolNamespace,
} from '@earendil-works/pi-coding-agent';
import {
  errorMessage,
  MCP_DEFERRED_TOOL_THRESHOLD,
  type McpServerConfig,
  type McpServerExposure,
  type McpToolRef,
} from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { McpApprovalBroker } from './approval.js';
import type { McpPreapproval } from './errors.js';
import type { McpFacade } from './facade.js';
import { mcpProxyName, mcpProxyPrefix } from './proxy-names.js';
import { mcpProxyTool, proxyNamespace } from './proxy-tool.js';
import { mcpResourceTools, type McpResourceServer } from './resource-tools.js';
import { matchToolPattern } from './servers.js';
import type { McpListedServer } from './types.js';

export { mcpProxyName, mcpProxyPrefix } from './proxy-names.js';

/**
 * Runner MCP tool proxies (D6): one frozen proxy per authorized tool, built
 * asynchronously at session assembly and registered through the authority
 * facade. Each binding pins its server revision and carries what pi 1.0
 * declares for it: the server's tool namespace with its instructions, and the
 * tool's exposure. Names: proxy-names.ts; the registered tool: proxy-tool.ts.
 * Catalog changes never reach an already-bound run: a deferred proxy is
 * registered at bind like a direct one, and `tool_search` only declares it.
 * Servers that expose resources add the resource tools (resource-tools.ts).
 */

export interface McpProxyHost {
  taskId: string;
  runId: () => string;
  executionId: () => string;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
  /** The task tier's say on a guarded call (`OperationContext.preapprove`); absent always asks. */
  preapprove?: (call: McpGuardedCall, signal?: AbortSignal) => Promise<McpPreapproval>;
  /**
   * Shows `runId`'s run as waiting while a guarded call's confirm waits, and as running once it
   * settles (`OperationContext.setStatus`).
   */
  setStatus: (status: 'awaiting_confirmation' | 'running') => void;
}

/** One proxy call the server's approval policy guards. */
export interface McpGuardedCall {
  toolCallId: string;
  serverId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface McpProxyOptions {
  facade: McpFacade;
  records: McpServerConfig[];
  /**
   * T6b additive: frozen staged selection. Absent means bind-all (current
   * behavior); present binds exactly the listed connectionId+tool pairs.
   */
  selected?: { connectionId: string; tool: string }[];
}

export interface McpProxyDetails {
  server: string;
  tool: string;
  isError: boolean;
  attachments: Array<{ artifactId: string | null; kind: string; note: string }>;
  limitsNote: string;
  progress?: { progress: number; total?: number; message?: string };
}

export interface McpToolBinding {
  proxyName: string;
  serverId: string;
  connectionId: string;
  tool: string;
  revision: number;
  ref: McpToolRef;
  /** The tool's boolean MCP hints; they inform pi and never relax an approval. */
  annotations?: ToolAnnotations;
  /** The server's namespace, shared by all its proxies (proxy-tool.ts `proxyNamespace`). */
  namespace: ToolNamespace;
  /** How the model reaches the proxy: its server's exposure for this run (`bindingExposure`). */
  exposure: Extract<ToolExposure, 'direct' | 'deferred'>;
  /** The server's policy asks the user about each call (`approveTools`), unless the tier allows it. */
  guarded: boolean;
}

/**
 * A server's exposure in one run: as configured, or for `auto` by how many tools the run binds
 * from it (`MCP_DEFERRED_TOOL_THRESHOLD`).
 */
export function bindingExposure(
  setting: McpServerExposure,
  tools: number,
): McpToolBinding['exposure'] {
  if (setting !== 'auto') return setting;
  return tools > MCP_DEFERRED_TOOL_THRESHOLD ? 'deferred' : 'direct';
}

/** What a run binds: its proxies, and the servers its resource tools reach (maybe none). */
export interface McpRunTools {
  factory: ExtensionFactory;
  /**
   * The same proxies and resource tools for another execution of the run, a subagent child:
   * `host` names whom each call belongs to and its tier's say, as the bind's own host does.
   */
  factoryFor: (host: McpProxyHost) => ExtensionFactory;
  bindings: McpToolBinding[];
  resourceServers: McpResourceServer[];
}

/**
 * Resolves the run-frozen catalog from the tools each connection last listed and returns the
 * registration factory. Unreachable servers are skipped with audit + warning, never fatal to
 * the bind; every registered proxy pins its server revision.
 */
export async function prepareMcpTools(
  host: McpProxyHost,
  options: McpProxyOptions,
  signal?: AbortSignal,
): Promise<McpRunTools> {
  const bindings: McpToolBinding[] = [];
  const resourceServers: McpResourceServer[] = [];
  const used = new Set<string>();
  // Servers list at once; binding follows record order, so proxy names do not depend on timing.
  const listed = await Promise.all(
    options.records
      .filter((record) => !record.disabled)
      .map(async (record) => {
        const listed = await options.facade
          .listedServer(record.serverId, signal)
          .catch((error: unknown): McpListedServer => {
            host.audit({
              taskId: host.taskId,
              runId: host.runId(),
              tool: `mcp:${record.serverId}`,
              decision: 'bind-skip',
              reason: errorMessage(error).slice(0, 500),
            });
            host.log.warn('MCP server skipped while binding run tools.', {
              serverId: record.serverId,
              error: errorMessage(error),
            });
            return { instructions: null, tools: [], resources: false };
          });
        return { record, ...listed };
      }),
  );
  for (const { record, instructions, tools, resources } of listed) {
    if (resources && record.exposeResources)
      resourceServers.push({ serverId: record.serverId, revision: record.revision });
    const namespace = proxyNamespace(
      mcpProxyPrefix(record.serverId),
      record.serverId,
      instructions,
    );
    const bound = tools.filter(({ ref }) => {
      if (record.includeTools.length && !matchToolPattern(record.includeTools, [ref.name]))
        return false;
      if (record.excludeTools.length && matchToolPattern(record.excludeTools, [ref.name]))
        return false;
      return (
        !options.selected ||
        options.selected.some(
          (item) => item.connectionId === record.connectionId && item.tool === ref.name,
        )
      );
    });
    const exposure = bindingExposure(record.exposure, bound.length);
    for (const { ref, annotations } of bound) {
      const proxyName = mcpProxyName(record.serverId, ref.name, used);
      used.add(proxyName);
      bindings.push({
        proxyName,
        serverId: record.serverId,
        connectionId: record.connectionId,
        tool: ref.name,
        revision: record.revision,
        ref,
        ...(annotations ? { annotations } : {}),
        namespace,
        exposure,
        guarded: McpApprovalBroker.approvalRequired(record.approveTools, ref.name),
      });
    }
  }
  const factoryFor =
    (target: McpProxyHost): ExtensionFactory =>
    (pi) => {
      for (const binding of bindings) pi.registerTool(mcpProxyTool(target, options, binding));
      if (resourceServers.length)
        for (const tool of mcpResourceTools(target, options.facade, resourceServers))
          pi.registerTool(tool);
    };
  if (options.selected)
    host.audit({
      taskId: host.taskId,
      runId: host.runId(),
      tool: 'mcp:selection',
      decision: 'applied',
      selected: options.selected.length,
      bound: bindings.length,
    });
  return { factory: factoryFor(host), factoryFor, bindings, resourceServers };
}
