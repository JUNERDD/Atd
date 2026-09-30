import { createHash, randomUUID } from 'node:crypto';
import { Type, type TSchema } from 'typebox';
import type {
  ExtensionFactory,
  ToolAnnotations,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { errorMessage, type McpServerConfig, type McpToolRef } from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import type { McpFacade } from './facade.js';
import { McpError, type McpPreapproval, type McpUpdate, type OperationContext } from './errors.js';
import { toPiText } from './mapping.js';
import { isJsonObject, normalizeInputSchema } from './policy.js';
import { matchToolPattern } from './servers.js';
import type { McpToolInfo } from './types.js';

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
}

/** Providers reject tool names over 64 characters; pi's own MCP tools stay within it too. */
const MAX_NAME_LENGTH = 64;
/** A name over the limit ends in `_` and this many hex characters of a hash. */
const NAME_HASH_LENGTH = 8;
/** What such a name keeps of the original: 55 characters, so `<kept>_<hash>` is 64 long. */
const KEPT_NAME_LENGTH = MAX_NAME_LENGTH - NAME_HASH_LENGTH - 1;
/** Hex characters of the server id hash in a prefix that carries one. */
const ID_HASH_LENGTH = 10;

/**
 * Proxy tool name: `mcp__<server>__<tool>`, sanitized for Pi and at most 64 characters. A longer
 * name keeps its first 55 characters and ends in `_` and 8 hex characters of SHA-256 over the raw
 * server id and tool name, as pi's `createMcpToolName` does, so tools that share their first 55
 * characters stay apart.
 *
 * `taken` holds the names other tools of the binding already have. Sanitizing can map `a.b` and
 * `a_b` to one name; the later tool then gets `_2`, `_3`, … after it. A numbered name that
 * outgrows the limit is shortened like any other, with the number in its hash, or every try would
 * shorten to the same name.
 */
export function mcpProxyName(
  serverId: string,
  tool: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const name = `${mcpProxyPrefix(serverId)}${cleanProxyPart(tool)}`;
  const seed = `${serverId}\0${tool}`;
  let candidate = fitProxyName(name, seed);
  for (let attempt = 2; taken.has(candidate); attempt += 1)
    candidate = fitProxyName(`${name}_${attempt}`, `${seed}\0${attempt}`);
  return candidate;
}

/** `name` when it fits the limit, else its first 55 characters, `_` and the hash of `seed`. */
function fitProxyName(name: string, seed: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, NAME_HASH_LENGTH);
  return `${name.slice(0, KEPT_NAME_LENGTH)}_${hash}`;
}

/**
 * The prefix every proxy of one server shares: `mcp__<server>__`. `references/material.ts` tells
 * the model to look for tools named `<prefix>*`, so it has to stay a true prefix of every proxy
 * name. A shortened name keeps only its first 55 characters (`fitProxyName`), so the prefix may
 * not run past 55 either: when the server id would take it further, the readable part is cut to
 * fit and a hash of the whole id follows it, so ids that share their start still get different
 * prefixes.
 *
 * A plugin server's qualified id (`<plugin>:<item>`) has characters the tool alphabet lacks, so
 * cleaning alone would give `kit:srv`, `kit.io:srv` and a user's `kit_srv` one prefix; it always
 * gets the readable part plus the hash, so its prefix names that server alone.
 */
export function mcpProxyPrefix(serverId: string): string {
  const readable = cleanProxyPart(serverId);
  const plain = `mcp__${readable}__`;
  if (!serverId.includes(':') && plain.length <= KEPT_NAME_LENGTH) return plain;
  const hash = createHash('sha256').update(serverId).digest('hex').slice(0, ID_HASH_LENGTH);
  const withHash = (part: string) => `mcp__${part}_${hash}__`;
  return withHash(readable.slice(0, KEPT_NAME_LENGTH - withHash('').length));
}

/** Runs of characters outside the tool alphabet become one `_`; the callers bound the length. */
function cleanProxyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_') || 'x';
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
    let tools: McpToolInfo[];
    try {
      tools = await options.facade.listToolInfo(record.serverId, signal);
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
    for (const { ref, annotations } of tools) {
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
  const parameters = proxyParameters(binding.ref.inputSchema);
  return {
    name: binding.proxyName,
    label: `MCP ${binding.serverId} ${binding.tool}`,
    description: `MCP tool ${binding.tool} on ${binding.serverId}. Approval is per call.`,
    parameters,
    ...(binding.annotations ? { annotations: binding.annotations } : {}),
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
      const input = args ?? {};
      if (!isJsonObject(input)) {
        throw new Error(`MCP tool ${binding.tool} takes a JSON object as its arguments.`);
      }
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
          // The server's machine-readable result, for pi's hooks; the model reads `content`.
          ...(isJsonObject(result.structuredContent)
            ? { structuredContent: result.structuredContent }
            : {}),
          // Pi (0.99+) honors the flag: the model gets an error result and the transcript shows
          // the call as failed. Without it the error text would read as a completed call.
          ...(result.isError ? { isError: true } : {}),
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

/** What models see of the tool's input: the normalized schema, or any object without one. */
function proxyParameters(inputSchema: unknown): TSchema {
  if (inputSchema && typeof inputSchema === 'object') {
    return Type.Unsafe<Record<string, unknown>>(normalizeInputSchema(inputSchema));
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
