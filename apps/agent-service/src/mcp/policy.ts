import type { AdapterInternals, AdapterToolDef } from './adapter-types.js';
import type { ConnectionManager } from './connect.js';
import { McpError, type OperationContext } from './errors.js';
import { matchToolPattern, matchUriTemplate } from './servers.js';
import type { McpServerConfig } from '@ai/agent-contracts';

/**
 * Per-connection/tool/URI authorization plus input validation. The adapter
 * stays authoritative for gateway filtering; the facade pre-checks every
 * direct Client call here so nothing reaches the wire unauthorized or
 * malformed. Schemas validate through the adapter's own JSON validator.
 */

export interface PolicyDeps {
  internals: AdapterInternals;
  connections: ConnectionManager;
  audit: (entry: Record<string, unknown>) => void;
}

export class McpPolicy {
  constructor(private readonly deps: PolicyDeps) {}

  checkRevision(record: McpServerConfig, op: OperationContext): void {
    if (op.configRevision !== undefined && op.configRevision !== record.revision) {
      throw new McpError(
        'conflict',
        record.serverId,
        `MCP server ${record.serverId} changed (revision ${record.revision}); the run keeps revision ${op.configRevision}.`,
      );
    }
  }

  authorizeTool(record: McpServerConfig, catalog: AdapterToolDef[], tool: string): AdapterToolDef {
    const definition = catalog.find((entry) => entry.name === tool);
    if (!definition) {
      this.deps.audit({
        taskId: '',
        runId: '',
        tool,
        server: record.serverId,
        decision: 'deny',
        reason: 'unknown-tool',
      });
      throw new McpError(
        'forbidden',
        record.serverId,
        `Tool ${tool} is not authorized on ${record.serverId}.`,
      );
    }
    if (record.includeTools.length && !matchToolPattern(record.includeTools, [definition.name])) {
      throw new McpError(
        'forbidden',
        record.serverId,
        `Tool ${tool} is not in the allowed set for ${record.serverId}.`,
      );
    }
    if (record.excludeTools.length && matchToolPattern(record.excludeTools, [definition.name])) {
      throw new McpError(
        'forbidden',
        record.serverId,
        `Tool ${tool} is excluded on ${record.serverId}.`,
      );
    }
    return definition;
  }

  async authorizeUri(
    record: McpServerConfig,
    physical: string,
    uri: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!record.exposeResources) {
      throw new McpError(
        'forbidden',
        record.serverId,
        `Resources are not exposed on ${record.serverId}.`,
      );
    }
    const connection = this.deps.connections.manager().getConnection(physical);
    if (!connection || connection.status !== 'connected') {
      throw new McpError(
        'auth_required',
        record.serverId,
        `MCP server ${record.serverId} is not connected.`,
      );
    }
    const [resources, templates] = await Promise.all([
      connection.client.listResources(
        undefined,
        this.deps.connections.requestOptions(physical, signal),
      ),
      connection.client
        .listResourceTemplates(undefined, this.deps.connections.requestOptions(physical, signal))
        .catch((): { resourceTemplates: Array<{ uriTemplate: string }> } => ({
          resourceTemplates: [],
        })),
    ]);
    const exact = resources.resources.some((resource) => resource.uri === uri);
    const templated = templates.resourceTemplates.some((template) =>
      matchUriTemplate(template.uriTemplate, uri),
    );
    if (!exact && !templated) {
      throw new McpError(
        'forbidden',
        record.serverId,
        `Resource ${uri.slice(0, 256)} is not authorized on ${record.serverId}.`,
      );
    }
  }

  authorizePrompt(catalog: Array<{ name: string }>, record: McpServerConfig, name: string): void {
    if (!catalog.some((prompt) => prompt.name === name)) {
      throw new McpError(
        'forbidden',
        record.serverId,
        `Prompt ${name} is not authorized on ${record.serverId}.`,
      );
    }
  }

  validateToolInput(
    record: McpServerConfig,
    definition: AdapterToolDef,
    input: Record<string, unknown>,
  ): void {
    const schema = definition.inputSchema;
    if (!schema || typeof schema !== 'object') return;
    let normalized: Record<string, unknown> = schema as Record<string, unknown>;
    try {
      normalized = this.deps.internals.normalizeDirectToolInputSchema?.(schema) ?? normalized;
    } catch {
      normalized = schema as Record<string, unknown>;
    }
    try {
      const provider = this.deps.internals.createJsonSchemaValidator();
      const validate = provider.getValidator(normalized);
      const outcome = validate(input);
      if (!outcome.valid) {
        throw new McpError(
          'bad_request',
          record.serverId,
          `Tool ${definition.name} arguments are invalid: ${outcome.errorMessage ?? 'schema mismatch'}.`,
        );
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        'bad_request',
        record.serverId,
        `Tool ${definition.name} arguments could not be validated.`,
      );
    }
  }
}
