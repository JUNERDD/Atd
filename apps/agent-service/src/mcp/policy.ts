import { errorMessage, type McpServerConfig } from '@ai/agent-contracts';
import { validateToolArguments, type JsonObject, type JsonValue } from '@earendil-works/pi-ai';
import type { ResourceTemplate, Tool } from '@earendil-works/pi-mcp';
import { Type } from 'typebox';
import { McpError, type OperationContext } from './errors.js';
import { matchToolPattern, matchUriTemplate } from './servers.js';
import type { McpLiveConnection } from './types.js';

/**
 * Per-connection/tool/URI authorization plus input validation. The facade checks every client
 * call here first, so nothing reaches the wire unauthorized or malformed. Arguments are
 * validated by pi-ai, the validator pi's agent loop runs on every proxy call, so a direct call
 * and a proxy call agree on what is valid and how loosely typed values are coerced.
 */

export interface PolicyDeps {
  audit: (entry: Record<string, unknown>) => void;
}

/** Longest list of argument failures a `bad_request` message carries. */
const MAX_FAILURE_TEXT = 1000;

/**
 * The schema tool arguments are validated against and models see: the server's input schema
 * without its top-level `$schema` and `additionalProperties`, or `{ type: 'object', properties:
 * {} }` for anything that is not an object. This is the rule of pi-mcp-adapter's
 * `normalizeDirectToolInputSchema`, which proxies used before the migration; keeping it exactly
 * keeps the parameters of every proxy byte-identical.
 */
export function normalizeInputSchema(schema: unknown): Record<string, unknown> {
  const normalized: Record<string, unknown> =
    typeof schema === 'object' && schema !== null && !Array.isArray(schema)
      ? { ...schema }
      : { type: 'object', properties: {} };
  delete normalized['$schema'];
  delete normalized['additionalProperties'];
  return normalized;
}

/** Whether `value` is plain data JSON can carry: what pi-ai's `JsonObject` promises. */
export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      return (
        value === null || (Array.isArray(value) ? value.every(isJsonValue) : isJsonObject(value))
      );
    default:
      return false;
  }
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

  authorizeTool(record: McpServerConfig, catalog: readonly Tool[], tool: string): Tool {
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

  /**
   * A URI is readable when the connection lists it or a listed template matches it. A server
   * without the resources capability lists nothing, and templates are optional: a server that
   * cannot list them has none.
   */
  async authorizeUri(
    record: McpServerConfig,
    connection: McpLiveConnection,
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
    const [resources, templates] = connection.capabilities.resources
      ? await connection.use((client) =>
          Promise.all([
            client.listResources({ signal }),
            client.listResourceTemplates({ signal }).catch((): ResourceTemplate[] => []),
          ]),
        )
      : [[], []];
    const exact = resources.some((resource) => resource.uri === uri);
    const templated = templates.some((template) => matchUriTemplate(template.uriTemplate, uri));
    if (!exact && !templated) {
      throw new McpError(
        'forbidden',
        record.serverId,
        `Resource ${uri.slice(0, 256)} is not authorized on ${record.serverId}.`,
      );
    }
  }

  authorizePrompt(
    catalog: ReadonlyArray<{ name: string }>,
    record: McpServerConfig,
    name: string,
  ): void {
    if (!catalog.some((prompt) => prompt.name === name)) {
      throw new McpError(
        'forbidden',
        record.serverId,
        `Prompt ${name} is not authorized on ${record.serverId}.`,
      );
    }
  }

  /**
   * Validates `input` against the tool's normalized input schema and answers the arguments to
   * send: pi-ai's copy, with loosely typed values coerced (`"5"` for an integer) and nulls
   * dropped from optional properties. The caller approves and sends this copy, never `input`.
   */
  validateToolInput(
    record: McpServerConfig,
    definition: Tool,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const name = definition.name;
    if (!isJsonObject(input)) {
      throw new McpError('bad_request', record.serverId, `Tool ${name} arguments must be JSON.`);
    }
    const parameters = Type.Unsafe<Record<string, unknown>>(
      normalizeInputSchema(definition.inputSchema),
    );
    let checked: unknown;
    try {
      checked = validateToolArguments(
        { name, description: '', parameters },
        { type: 'toolCall', id: '', name, arguments: input },
      );
    } catch (error) {
      throw new McpError('bad_request', record.serverId, argumentProblem(name, error));
    }
    if (!isJsonObject(checked)) {
      throw new McpError(
        'bad_request',
        record.serverId,
        `Tool ${name} arguments could not be validated.`,
      );
    }
    return checked;
  }
}

/**
 * The message of a failed validation. pi-ai lists each failure as `  - <path>: <message>`
 * between a heading and the arguments it echoes; only the failures go on, capped. A schema
 * that could not even be compiled has none, and says so.
 */
function argumentProblem(name: string, error: unknown): string {
  const report = errorMessage(error).split('\n\nReceived arguments:')[0] ?? '';
  const failures = report
    .split('\n')
    .filter((line) => line.startsWith('  - '))
    .map((line) => line.slice(4));
  if (failures.length === 0) return `Tool ${name} arguments could not be validated.`;
  return `Tool ${name} arguments are invalid: ${failures.join('; ').slice(0, MAX_FAILURE_TEXT)}.`;
}
