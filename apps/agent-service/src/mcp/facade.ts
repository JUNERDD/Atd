import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  type McpCallResult,
  type McpGetPromptResponse,
  type McpPromptRef,
  type McpReadResourceResponse,
  type McpResourceRef,
  type McpResourceTemplateRef,
  type McpServerConfig,
  type McpToolRef,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import type { AdapterInternals, AdapterToolDef } from './adapter-types.js';
import { McpApprovalBroker } from './approval.js';
import { ConnectionManager } from './connect.js';
import {
  isForbidden,
  isUnauthorized,
  McpError,
  type ManagerAccessor,
  type MappingDeps,
  type McpStateSink,
  type McpUpdate,
  type OperationContext,
  type SecretResolver,
  type ServerResolver,
} from './errors.js';
import { mapCallResult, mapGetPrompt, mapReadResource } from './mapping.js';
import { McpPolicy } from './policy.js';
import { CredentialTransactions } from './transactions.js';

/**
 * Typed control facade (D6): the only path runners use to reach MCP, reusing
 * the adapter Clients for lists, reads, prompts and calls. Connections,
 * policy and errors live in their own modules.
 */

export interface FacadeDeps {
  internals: AdapterInternals;
  manager: ManagerAccessor;
  servers: ServerResolver;
  secrets: SecretResolver;
  states: McpStateSink;
  txns: CredentialTransactions;
  approvals: McpApprovalBroker;
  mapping: MappingDeps;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
  onDispatch?: (info: { serverId: string; tool: string }) => void;
}

export class McpFacade {
  private readonly connections: ConnectionManager;
  private readonly policy: McpPolicy;

  constructor(private readonly deps: FacadeDeps) {
    this.connections = new ConnectionManager({
      manager: deps.manager,
      servers: deps.servers,
      secrets: deps.secrets,
      states: deps.states,
      txns: deps.txns,
      log: deps.log,
    });
    this.policy = new McpPolicy({
      internals: deps.internals,
      connections: this.connections,
      audit: deps.audit,
    });
  }

  connect(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void> {
    return this.connections.connect(serverId, signal, taskId);
  }

  disconnect(serverId: string): Promise<void> {
    return this.connections.disconnect(serverId);
  }

  reconnect(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void> {
    return this.connections.reconnect(serverId, signal, taskId);
  }

  async listTools(serverId: string, signal?: AbortSignal, taskId?: string): Promise<McpToolRef[]> {
    const ensured = await this.connections.ensure(serverId, signal, taskId);
    const options = this.connections.requestOptions(ensured.physical, signal);
    const live = await ensured.connection.client.listTools(undefined, options);
    return live.tools.map((tool) => toToolRef(ensured.record, tool));
  }

  async listResources(
    serverId: string,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<McpResourceRef[]> {
    const ensured = await this.connections.ensure(serverId, signal, taskId);
    if (!ensured.record.exposeResources) return [];
    const options = this.connections.requestOptions(ensured.physical, signal);
    const live = await ensured.connection.client.listResources(undefined, options);
    return live.resources.map((resource) => ({
      serverId: ensured.record.serverId,
      connectionId: ensured.record.connectionId,
      uri: resource.uri,
      name: resource.name,
      description: typeof resource.description === 'string' ? resource.description : null,
      mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : null,
      meta: resource._meta ?? null,
    }));
  }

  async listResourceTemplates(
    serverId: string,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<McpResourceTemplateRef[]> {
    const ensured = await this.connections.ensure(serverId, signal, taskId);
    if (!ensured.record.exposeResources) return [];
    const options = this.connections.requestOptions(ensured.physical, signal);
    const live = await ensured.connection.client.listResourceTemplates(undefined, options);
    return live.resourceTemplates.map((template) => ({
      serverId: ensured.record.serverId,
      connectionId: ensured.record.connectionId,
      uriTemplate: template.uriTemplate,
      name: template.name,
      description: typeof template.description === 'string' ? template.description : null,
      mimeType: typeof template.mimeType === 'string' ? template.mimeType : null,
      meta: template._meta ?? null,
    }));
  }

  async listPrompts(
    serverId: string,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<McpPromptRef[]> {
    const ensured = await this.connections.ensure(serverId, signal, taskId);
    const options = this.connections.requestOptions(ensured.physical, signal);
    const live = await ensured.connection.client.listPrompts(undefined, options);
    return live.prompts.map((prompt) => ({
      serverId: ensured.record.serverId,
      connectionId: ensured.record.connectionId,
      name: prompt.name,
      title: typeof prompt.title === 'string' ? prompt.title : null,
      description: typeof prompt.description === 'string' ? prompt.description : null,
      args: (prompt.arguments ?? []).map((arg) => ({
        name: arg.name,
        description: typeof arg.description === 'string' ? arg.description : null,
        required: typeof arg.required === 'boolean' ? arg.required : null,
      })),
      meta: prompt._meta ?? null,
    }));
  }

  async readResource(
    op: OperationContext,
    serverId: string,
    uri: string,
    signal?: AbortSignal,
  ): Promise<McpReadResourceResponse> {
    signal?.throwIfAborted();
    const { record, physical } = await this.connections.ensure(serverId, signal, op.taskId);
    this.policy.checkRevision(record, op);
    await this.policy.authorizeUri(record, physical, uri, signal);
    this.deps.audit({
      ...this.base(op),
      server: serverId,
      tool: `resource:${uri.slice(0, 256)}`,
      decision: 'allow',
    });
    try {
      const raw = await this.connections.manager().readResource(physical, uri, signal);
      return mapReadResource(raw, { serverId, uri, taskId: op.taskId });
    } catch (error) {
      throw this.translateCallError(serverId, error);
    }
  }

  async getPrompt(
    op: OperationContext,
    serverId: string,
    name: string,
    args?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<McpGetPromptResponse> {
    signal?.throwIfAborted();
    const ensured = await this.connections.ensure(serverId, signal, op.taskId);
    const record = ensured.record;
    this.policy.checkRevision(record, op);
    const options = this.connections.requestOptions(ensured.physical, signal);
    const prompts = await ensured.connection.client.listPrompts(undefined, options);
    this.policy.authorizePrompt(prompts.prompts, record, name);
    this.deps.audit({
      ...this.base(op),
      server: serverId,
      tool: `prompt:${name}`,
      decision: 'allow',
    });
    try {
      const raw = await this.connections.manager().getPrompt(ensured.physical, name, args, signal);
      return mapGetPrompt(raw, { serverId, name, taskId: op.taskId });
    } catch (error) {
      throw this.translateCallError(serverId, error);
    }
  }

  async callTool(
    op: OperationContext,
    serverId: string,
    tool: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal,
    onUpdate?: (update: McpUpdate) => void,
  ): Promise<McpCallResult> {
    signal?.throwIfAborted();
    const ensured = await this.connections.ensure(serverId, signal, op.taskId);
    const record = ensured.record;
    const connection = ensured.connection;
    const physical = ensured.physical;
    this.policy.checkRevision(record, op);
    const catalog = await connection.client.listTools(
      undefined,
      this.connections.requestOptions(physical, signal),
    );
    const definition = this.policy.authorizeTool(record, catalog.tools, tool);
    const input = args ?? {};
    this.policy.validateToolInput(record, definition, input);
    const guarded = McpApprovalBroker.approvalRequired(record.approveTools, definition.name);
    // The preapproval audits its own decision; a refused one hands its review to the confirm.
    const preapproval = guarded ? await op.preapprove?.(signal) : undefined;
    if (guarded && !preapproval?.allowed) {
      const decision = await this.deps.approvals.decide(
        {
          taskId: op.taskId,
          runId: op.runId,
          executionId: op.executionId,
          toolCallId: op.toolCallId ?? randomUUID(),
          serverId,
          connectionId: record.connectionId,
          toolName: definition.name,
          origin: 'facade',
          args: input,
          ...(preapproval?.review ? { review: preapproval.review } : {}),
        },
        signal,
      );
      if (decision === 'deny') {
        throw new McpError(
          'forbidden',
          serverId,
          `The user declined MCP tool ${definition.name} on ${serverId}.`,
        );
      }
    } else if (!guarded) {
      this.deps.audit({
        ...this.base(op),
        server: serverId,
        tool: definition.name,
        decision: 'policy-allow',
      });
    }
    this.deps.onDispatch?.({ serverId, tool: definition.name });
    signal?.throwIfAborted();
    try {
      const raw = await connection.client.callTool(
        { name: definition.name, arguments: input },
        {
          ...this.connections.requestOptions(physical, signal),
          ...(signal ? { signal } : {}),
          onprogress: onUpdate
            ? (progress) => {
                onUpdate({
                  kind: 'progress',
                  progress: progress.progress,
                  ...(progress.total !== undefined ? { total: progress.total } : {}),
                  ...(progress.message ? { message: progress.message } : {}),
                });
              }
            : undefined,
        },
      );
      return await mapCallResult(this.deps.mapping, raw, {
        serverId,
        tool: definition.name,
        taskId: op.taskId,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw this.translateCallError(serverId, error);
    }
  }

  private translateCallError(serverId: string, error: unknown): McpError {
    if (error instanceof McpError) return error;
    if (isUnauthorized(error)) {
      this.deps.states.set(serverId, 'auth_required', '');
      return new McpError(
        'auth_required',
        serverId,
        `MCP server ${serverId} needs authentication.`,
      );
    }
    if (isForbidden(error)) {
      // 403 scope step-up is an explicit reauth, never a silent replay.
      this.deps.states.set(serverId, 'auth_required', '');
      return new McpError(
        'auth_required',
        serverId,
        `MCP server ${serverId} refused the credential (reauthentication required).`,
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return new McpError('internal', serverId, 'The MCP call was cancelled.');
    }
    return new McpError('internal', serverId, errorMessage(error));
  }

  private base(op: OperationContext): Record<string, unknown> {
    return {
      taskId: op.taskId,
      runId: op.runId,
      executionId: op.executionId,
      operationId: op.operationId,
    };
  }
}

function toToolRef(record: McpServerConfig, tool: AdapterToolDef): McpToolRef {
  return {
    serverId: record.serverId,
    connectionId: record.connectionId,
    name: tool.name,
    title: typeof tool.title === 'string' ? tool.title : null,
    description: typeof tool.description === 'string' ? tool.description : null,
    inputSchema: tool.inputSchema ?? null,
    outputSchema: tool.outputSchema ?? null,
    meta: tool._meta ?? null,
  };
}
