import { randomUUID } from 'node:crypto';
import { Type, type TSchema } from 'typebox';
import type { ToolDefinition, ToolNamespace } from '@earendil-works/pi-coding-agent';
import type { JsonObject } from '@earendil-works/pi-ai';
import {
  errorMessage,
  type McpAttachment,
  type McpCallResult,
  type McpToolRef,
} from '@ai/agent-contracts';
import { McpError, type McpUpdate, type OperationContext } from './errors.js';
import { toPiContent } from './model-content.js';
import { isJsonObject, normalizeInputSchema } from './policy.js';
import type {
  McpProxyDetails,
  McpProxyHost,
  McpProxyOptions,
  McpToolBinding,
} from './tool-proxies.js';

/**
 * The pi tool one binding registers: what it declares (pi 1.0's fields: description, namespace,
 * exposure, annotations, output schema) and what a call does. Approval is claimed per operation by
 * the facade, inputs are validated, AuditSignal cancels, and MCP progress bridges to pi partial
 * updates.
 */

/**
 * What the model reads about a tool: the server's description, else its title, else a line that
 * names it, and a short note when the server's policy asks the user to approve each call.
 */
export function proxyDescription(ref: McpToolRef, guarded: boolean): string {
  const text =
    ref.description?.trim() || ref.title?.trim() || `MCP tool ${ref.name} on ${ref.serverId}.`;
  return guarded ? `${text}\n\nApproval is per call.` : text;
}

/**
 * The namespace every proxy of one server shares: its proxy prefix without the trailing `__`
 * (`mcpProxyNamespace` reads it back from a proxy name), which server it is, and the server's
 * instructions when it sent any.
 */
export function proxyNamespace(
  prefix: string,
  serverId: string,
  instructions: string | null,
): ToolNamespace {
  return {
    name: prefix.slice(0, -2),
    description: `MCP server ${serverId}`,
    ...(instructions ? { instructions } : {}),
  };
}

export function mcpProxyTool(
  host: McpProxyHost,
  options: McpProxyOptions,
  binding: McpToolBinding,
): ToolDefinition<TSchema, McpProxyDetails, unknown> {
  return {
    name: binding.proxyName,
    label: `MCP ${binding.serverId} ${binding.tool}`,
    description: proxyDescription(binding.ref, binding.guarded),
    parameters: proxyParameters(binding.ref.inputSchema),
    outputSchema: callResultSchema(binding.ref.outputSchema),
    exposure: binding.exposure,
    namespace: binding.namespace,
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
          content: toPiContent(result, (id) => options.facade.mapping.resources.pathOf(id)),
          details: proxyDetails(binding, result.isError, result.attachments, result.limitsNote),
          // What a codemode script's call resolves to (`outputSchema`); the model reads `content`.
          structuredContent: toolResultValue(result),
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

/**
 * Every proxy's output schema: the `CallToolResult` codemode scripts receive, with the tool's own
 * output schema as `structuredContent`, in the shape pi's MCP tools declare
 * (`createMcpResultSchema`), which codemode renders as `CallToolResult<T>`.
 */
function callResultSchema(outputSchema: unknown): TSchema {
  return Type.Unsafe<Record<string, unknown>>({
    type: 'object',
    properties: {
      content: { type: 'array', items: { type: 'object' } },
      ...(isJsonObject(outputSchema) ? { structuredContent: outputSchema } : {}),
      isError: { type: 'boolean' },
      _meta: { type: 'object' },
    },
    required: ['content'],
  });
}

/**
 * The result as a script receives it: the content blocks after the facade's mapping (binary
 * payloads already artifacts, long text cut with its whole text kept), the server's structured
 * content and the error flag. Never `_meta`, like pi's own MCP tools.
 */
function toolResultValue(result: McpCallResult): JsonObject {
  const { content, isError } = result;
  const structuredContent = result.structuredContent ?? undefined;
  // A JSON round trip drops undefined members, which a JSON value cannot hold.
  const value: unknown = JSON.parse(JSON.stringify({ content, structuredContent, isError }));
  return isJsonObject(value) ? value : { content: [], isError };
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
  attachments: McpAttachment[],
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
