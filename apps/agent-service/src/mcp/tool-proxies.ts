import { randomUUID } from 'node:crypto';
import { Type, type TSchema } from 'typebox';
import type { ExtensionFactory, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { errorMessage, type McpServerConfig, type McpToolRef } from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { McpFacade } from './facade.js';
import { McpError, type McpPreapproval, type McpUpdate, type OperationContext } from './errors.js';
import { toPiText } from './mapping.js';
import { matchToolPattern } from './servers.js';

/**
 * Runner MCP tool proxies (D6): one frozen proxy per authorized tool, built
 * asynchronously at session assembly and registered through the authority
 * facade. Approval is claimed per operation (`allow_once`/`deny`), inputs
 * are validated, AuditSignal cancels, and MCP progress bridges to Pi
 * partial updates. Catalog changes never reach an already-bound run.
 */

export interface McpProxyHost {
  taskId: string;
  runId: () => string;
  executionId: () => string;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
  /** The task tier's say on a guarded call (`OperationContext.preapprove`); absent always asks. */
  preapprove?: (call: McpGuardedCall, signal?: AbortSignal) => Promise<McpPreapproval>;
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
  normalizeSchema?: (schema: unknown) => Record<string, unknown>;
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
}

/** Proxy tool name: `mcp__<server>__<tool>`, sanitized for Pi. */
export function mcpProxyName(serverId: string, tool: string): string {
  return `${mcpProxyPrefix(serverId)}${cleanProxyPart(tool)}`;
}

/** The prefix every proxy of one server shares: `mcp__<server>__`. */
export function mcpProxyPrefix(serverId: string): string {
  return `mcp__${cleanProxyPart(serverId)}__`;
}

function cleanProxyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 80) || 'x';
}

/**
 * Resolves the run-frozen catalog and returns the registration factory.
 * Unreachable servers are skipped with audit + warning, never fatal to
 * the bind; every registered proxy pins its server revision.
 */
export async function prepareMcpTools(
  host: McpProxyHost,
  options: McpProxyOptions,
  signal?: AbortSignal,
): Promise<{ factory: ExtensionFactory; bindings: McpToolBinding[] }> {
  const bindings: McpToolBinding[] = [];
  const used = new Set<string>();
  for (const record of options.records) {
    if (record.disabled) continue;
    let tools: McpToolRef[];
    try {
      tools = await options.facade.listTools(record.serverId, signal);
    } catch (error) {
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
      continue;
    }
    for (const ref of tools) {
      if (record.includeTools.length && !matchToolPattern(record.includeTools, [ref.name]))
        continue;
      if (record.excludeTools.length && matchToolPattern(record.excludeTools, [ref.name])) continue;
      if (
        options.selected &&
        !options.selected.some(
          (item) => item.connectionId === record.connectionId && item.tool === ref.name,
        )
      )
        continue;
      let proxyName = mcpProxyName(record.serverId, ref.name);
      for (let attempt = 2; used.has(proxyName); attempt += 1)
        proxyName = `${mcpProxyName(record.serverId, ref.name)}_${attempt}`;
      used.add(proxyName);
      bindings.push({
        proxyName,
        serverId: record.serverId,
        connectionId: record.connectionId,
        tool: ref.name,
        revision: record.revision,
        ref,
      });
    }
  }
  const factory: ExtensionFactory = (pi) => {
    for (const binding of bindings) pi.registerTool(mcpProxyTool(host, options, binding));
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
  return { factory, bindings };
}

function mcpProxyTool(
  host: McpProxyHost,
  options: McpProxyOptions,
  binding: McpToolBinding,
): ToolDefinition<TSchema, McpProxyDetails, unknown> {
  const parameters = proxyParameters(options, binding.ref.inputSchema);
  return {
    name: binding.proxyName,
    label: `MCP ${binding.serverId} ${binding.tool}`,
    description: `MCP tool ${binding.tool} on ${binding.serverId}. Approval is per call.`,
    parameters,
    executionMode: 'sequential',
    async execute(id, args, signal, onUpdate, _ctx) {
      signal?.throwIfAborted();
      const op: OperationContext = {
        operationId: randomUUID(),
        taskId: host.taskId,
        runId: host.runId(),
        executionId: host.executionId(),
        toolCallId: id,
        configRevision: binding.revision,
      };
      const input = (args ?? {}) as Record<string, unknown>;
      const preapprove = host.preapprove;
      if (preapprove) {
        const call = {
          toolCallId: id,
          serverId: binding.serverId,
          tool: binding.tool,
          args: input,
        };
        op.preapprove = (callSignal) => preapprove(call, callSignal);
      }
      const bridge = onUpdate
        ? (update: McpUpdate) => {
            onUpdate({
              content: [{ type: 'text', text: progressText(binding, update) }],
              details: proxyDetails(binding, false, [], '', update),
            });
          }
        : undefined;
      try {
        const result = await options.facade.callTool(
          op,
          binding.serverId,
          binding.tool,
          input,
          signal,
          bridge,
        );
        return {
          content: [{ type: 'text', text: toPiText(result) }],
          details: proxyDetails(binding, result.isError, result.attachments, result.limitsNote),
        };
      } catch (error) {
        if (
          error instanceof McpError &&
          error.code === 'forbidden' &&
          /declined/i.test(error.message)
        ) {
          throw new Error('The user declined this action.');
        }
        throw new Error(errorMessage(error));
      }
    },
  };
}

function proxyParameters(options: McpProxyOptions, inputSchema: unknown): TSchema {
  if (inputSchema && typeof inputSchema === 'object') {
    try {
      const normalized =
        options.normalizeSchema?.(inputSchema) ?? (inputSchema as Record<string, unknown>);
      return Type.Unsafe<Record<string, unknown>>(normalized);
    } catch {
      return Type.Unsafe<Record<string, unknown>>(inputSchema as Record<string, unknown>);
    }
  }
  return Type.Record(Type.String(), Type.Unknown());
}

function proxyDetails(
  binding: McpToolBinding,
  isError: boolean,
  attachments: Array<{ artifactId: string | null; kind: string; note: string }>,
  limitsNote: string,
  progress?: { progress: number; total?: number; message?: string },
): McpProxyDetails {
  return {
    server: binding.serverId,
    tool: binding.tool,
    isError,
    attachments: attachments.map((attachment) => ({
      artifactId: attachment.artifactId,
      kind: attachment.kind,
      note: attachment.note,
    })),
    limitsNote,
    ...(progress ? { progress } : {}),
  };
}

function progressText(binding: McpToolBinding, update: McpUpdate): string {
  const ratio =
    update.total === undefined ? `${update.progress}` : `${update.progress}/${update.total}`;
  return update.message
    ? `MCP ${binding.serverId}/${binding.tool}: ${update.message} (${ratio})`
    : `MCP ${binding.serverId}/${binding.tool}: ${ratio}`;
}
