import { randomUUID } from 'node:crypto';
import type {
  McpCallResult,
  McpGetPromptResponse,
  McpPromptRef,
  McpReadResourceResponse,
  McpResourceRef,
  McpResourceTemplateRef,
  McpServerConfig,
  McpToolRef,
} from '@atd/agent-contracts';
import type { McpRequestOptions, ProgressNotification, Tool } from '@earendil-works/pi-mcp';
import type { Logger } from '../logging.js';
import { McpApprovalBroker } from './approval.js';
import {
  listAllPrompts,
  listTemplatesOrNone,
  type RawPrompt,
  toPromptRef,
  toResourceRef,
  toTemplateRef,
  toToolInfo,
  withSignal,
} from './catalog.js';
import {
  McpError,
  type MappingDeps,
  type McpStateSink,
  type McpUpdate,
  type OperationContext,
} from './errors.js';
import { mapCallResult, mapGetPrompt, mapReadResource } from './mapping.js';
import { OperationSession, translateCallError, type OperationTarget } from './operation.js';
import { McpPolicy } from './policy.js';
import type { McpConnections, McpListedServer, McpLiveConnection } from './types.js';

/**
 * Typed control facade (D6): the only path runners and routes use to reach MCP. It takes its
 * connections from `McpConnections` and sends every request through `McpLiveConnection.use`;
 * `tools/call` is reachable only from `callTool`, behind the revision pin, the live catalog,
 * argument validation and approval. Connections, policy and errors live in their own modules.
 */

export interface FacadeDeps {
  connections: McpConnections;
  /** A request the server answers 401 or 403 moves the logical server to `auth_required`. */
  states: McpStateSink;
  approvals: McpApprovalBroker;
  mapping: MappingDeps;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
  onDispatch?: (info: { serverId: string; tool: string }) => void;
}

export class McpFacade {
  /** Connections; `launchSpec` is also what launch approvals fingerprint. */
  readonly connections: McpConnections;
  /** Where results keep their artifacts, for the runner tools that map them (resource-tools.ts). */
  readonly mapping: MappingDeps;
  private readonly policy: McpPolicy;

  constructor(private readonly deps: FacadeDeps) {
    this.connections = deps.connections;
    this.mapping = deps.mapping;
    this.policy = new McpPolicy({ audit: deps.audit });
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

  /** The tools the server lists now; route listings read the server, not the connection's list. */
  listTools(serverId: string, signal?: AbortSignal, taskId?: string): Promise<McpToolRef[]> {
    return this.operation({ serverId, signal, taskId }, (session) =>
      session.run(async ({ record, connection }) => {
        const tools = await this.liveTools(connection, signal);
        return tools.map((tool) => toToolInfo(record, tool).ref);
      }),
    );
  }

  /**
   * The server's instructions, whether it offers resources, and its tools with their boolean
   * annotation hints (which inform pi and never relax an approval) as the connection last listed
   * them: at the connect, and on every `tools/list_changed`. So binding a run's proxies sends no request while the connection stays
   * open; a call still authorizes against the live list (`callTool`).
   */
  listedServer(serverId: string, signal?: AbortSignal): Promise<McpListedServer> {
    return this.operation({ serverId, signal, taskId: undefined }, (session) =>
      session.run(async ({ record, connection }) => ({
        instructions: connection.instructions,
        tools: connection.tools().map((tool) => toToolInfo(record, tool)),
        resources: connection.capabilities.resources !== undefined,
      })),
    );
  }

  listResources(
    serverId: string,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<McpResourceRef[]> {
    return this.operation({ serverId, signal, taskId }, (session) =>
      session.run(async ({ record, connection }) => {
        if (!record.exposeResources || !connection.capabilities.resources) return [];
        const resources = await connection.use((client) =>
          client.listResources(withSignal(signal)),
        );
        return resources.map((resource) => toResourceRef(record, resource));
      }),
    );
  }

  listResourceTemplates(
    serverId: string,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<McpResourceTemplateRef[]> {
    return this.operation({ serverId, signal, taskId }, (session) =>
      session.run(async ({ record, connection }) => {
        if (!record.exposeResources || !connection.capabilities.resources) return [];
        const templates = await connection.use((client) =>
          listTemplatesOrNone(client, withSignal(signal)),
        );
        return templates.map((template) => toTemplateRef(record, template));
      }),
    );
  }

  listPrompts(serverId: string, signal?: AbortSignal, taskId?: string): Promise<McpPromptRef[]> {
    return this.operation({ serverId, signal, taskId }, (session) =>
      session.run(async ({ record, connection }) => {
        const prompts = await this.livePrompts(connection, signal);
        return prompts.map((prompt) => toPromptRef(record, prompt));
      }),
    );
  }

  async readResource(
    op: OperationContext,
    serverId: string,
    uri: string,
    signal?: AbortSignal,
  ): Promise<McpReadResourceResponse> {
    signal?.throwIfAborted();
    return this.operation({ serverId, signal, taskId: op.taskId, op }, async (session) => {
      await session.run(({ record, connection }) =>
        this.policy.authorizeUri(record, connection, uri, signal),
      );
      this.deps.audit({
        ...this.base(op),
        server: serverId,
        tool: `resource:${uri.slice(0, 256)}`,
        decision: 'allow',
      });
      const raw = await session.run(({ connection }) =>
        connection.use((client) => client.readResource(uri, withSignal(signal))),
      );
      return mapReadResource(raw, { serverId, uri, taskId: op.taskId });
    });
  }

  async getPrompt(
    op: OperationContext,
    serverId: string,
    name: string,
    args?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<McpGetPromptResponse> {
    signal?.throwIfAborted();
    return this.operation({ serverId, signal, taskId: op.taskId, op }, async (session) => {
      await session.run(async ({ record, connection }) => {
        this.policy.authorizePrompt(await this.livePrompts(connection, signal), record, name);
      });
      this.deps.audit({
        ...this.base(op),
        server: serverId,
        tool: `prompt:${name}`,
        decision: 'allow',
      });
      const params = { name, ...(args ? { arguments: args } : {}) };
      const raw = await session.run(({ connection }) =>
        connection.use((client) => client.request('prompts/get', params, withSignal(signal))),
      );
      return mapGetPrompt(raw, { serverId, name, taskId: op.taskId });
    });
  }

  /**
   * Runs a tool: revision pin, live catalog, authorization, validation, approval, dispatch. The
   * arguments approved and sent are the validated copy, so the user sees what the server gets.
   */
  async callTool(
    op: OperationContext,
    serverId: string,
    tool: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal,
    onUpdate?: (update: McpUpdate) => void,
  ): Promise<McpCallResult> {
    signal?.throwIfAborted();
    return this.operation({ serverId, signal, taskId: op.taskId, op }, async (session) => {
      const { record, definition } = await session.run(async ({ record, connection }) => ({
        record,
        definition: this.policy.authorizeTool(
          record,
          await this.liveTools(connection, signal),
          tool,
        ),
      }));
      const input = this.policy.validateToolInput(record, definition, args ?? {});
      await this.approve(op, record, definition.name, input, signal);
      this.deps.onDispatch?.({ serverId, tool: definition.name });
      signal?.throwIfAborted();
      const options: McpRequestOptions = {
        ...withSignal(signal),
        ...(onUpdate && {
          onProgress: (progress: ProgressNotification) => onUpdate(update(progress)),
        }),
      };
      const raw = await session.run(({ connection }) =>
        connection.use((client) => client.callTool(definition.name, input, options)),
      );
      return mapCallResult(this.deps.mapping, raw, {
        serverId,
        tool: definition.name,
        taskId: op.taskId,
      });
    });
  }

  /** The tools the server lists now; a server without the tools capability lists none. */
  private liveTools(connection: McpLiveConnection, signal?: AbortSignal): Promise<Tool[]> {
    if (!connection.capabilities.tools) return Promise.resolve([]);
    return connection.use((client) => client.listTools(withSignal(signal)));
  }

  private livePrompts(connection: McpLiveConnection, signal?: AbortSignal): Promise<RawPrompt[]> {
    if (!connection.capabilities.prompts) return Promise.resolve([]);
    return connection.use((client) => listAllPrompts(client, withSignal(signal)));
  }

  /**
   * The server policy's say on one call: tools it does not guard run; a guarded one runs when
   * the task tier preapproves it, else the user confirms it (a decline throws `forbidden`), or in
   * an unattended run the approval refuses it at once.
   */
  private async approve(
    op: OperationContext,
    record: McpServerConfig,
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const serverId = record.serverId;
    if (!McpApprovalBroker.approvalRequired(record.approveTools, toolName)) {
      this.deps.audit({
        ...this.base(op),
        server: serverId,
        tool: toolName,
        decision: 'policy-allow',
      });
      return;
    }
    // The preapproval audits its own decision; a refused one hands its review to the confirm.
    const preapproval = await op.preapprove?.(signal);
    if (preapproval?.allowed) return;
    const decision = await this.deps.approvals.decide(
      {
        taskId: op.taskId,
        runId: op.runId,
        executionId: op.executionId,
        toolCallId: op.toolCallId ?? randomUUID(),
        serverId,
        connectionId: record.connectionId,
        toolName,
        origin: 'facade',
        args: input,
        ...(preapproval?.review ? { review: preapproval.review } : {}),
        ...(preapproval?.unattended ? { unattended: true } : {}),
        ...(op.setStatus ? { setStatus: op.setStatus } : {}),
      },
      signal,
    );
    if (decision === 'deny') {
      throw new McpError(
        'forbidden',
        serverId,
        `The user declined MCP tool ${toolName} on ${serverId}.`,
      );
    }
  }

  /**
   * Opens the operation's connection and translates what fails on it into `McpError`s. A caller
   * that hung up gets its own abort back.
   */
  private async operation<T>(
    target: OperationTarget,
    work: (session: OperationSession) => Promise<T>,
  ): Promise<T> {
    const { op } = target;
    const pin = (record: McpServerConfig) => {
      if (op) this.policy.checkRevision(record, op);
    };
    try {
      return await work(await OperationSession.open(this.connections, this.deps.log, target, pin));
    } catch (error) {
      if (target.signal?.aborted) throw error;
      throw translateCallError(this.deps.states, target.serverId, error);
    }
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

function update(progress: ProgressNotification): McpUpdate {
  return {
    kind: 'progress',
    progress: progress.progress,
    ...(progress.total !== undefined ? { total: progress.total } : {}),
    ...(progress.message ? { message: progress.message } : {}),
  };
}
