import type {
  McpPromptRef,
  McpResourceRef,
  McpResourceTemplateRef,
  McpServerConfig,
  McpToolRef,
} from '@atd/agent-contracts';
import type { ToolAnnotations } from '@earendil-works/pi-coding-agent';
import {
  JSON_RPC_ERROR_CODES,
  McpError as McpRpcError,
  type McpClient,
  type McpRequestOptions,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from '@earendil-works/pi-mcp';
import { isUnauthorized } from './errors.js';
import type { McpCatalogCounter, McpToolInfo } from './types.js';

/**
 * What a connected server lists (tools, resources, templates, prompts) and how the app names it:
 * the wire refs of `/v1/mcp/*`, the annotation hints proxies carry, and the catalog sizes status
 * rows show. Prompts are the one list pi-mcp's client has no method for, so `listAllPrompts`
 * pages `prompts/list` through `client.request` the way pi-mcp pages its own lists.
 */

/** pi-mcp's cap on the pages of one list. */
const MAX_LIST_PAGES = 1_000;

/** Request options carrying the caller's abort signal when it has one. */
export function withSignal(signal: AbortSignal | undefined): McpRequestOptions {
  return signal ? { signal } : {};
}

const ANNOTATION_HINTS: readonly (keyof ToolAnnotations)[] = [
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
];

/**
 * The boolean hints of a tool's MCP annotations, or undefined when it has none (pi's own MCP
 * tools map them the same way). Hints come from the server's author and are not verified: they
 * inform pi, and never relax an approval.
 */
export function toolAnnotations(tool: Tool): ToolAnnotations | undefined {
  const hints: ToolAnnotations = {};
  for (const hint of ANNOTATION_HINTS) {
    const value: unknown = tool.annotations?.[hint];
    if (typeof value === 'boolean') hints[hint] = value;
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

export function toToolRef(record: McpServerConfig, tool: Tool): McpToolRef {
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

export function toToolInfo(record: McpServerConfig, tool: Tool): McpToolInfo {
  const annotations = toolAnnotations(tool);
  return { ref: toToolRef(record, tool), ...(annotations ? { annotations } : {}) };
}

export function toResourceRef(record: McpServerConfig, resource: Resource): McpResourceRef {
  return {
    serverId: record.serverId,
    connectionId: record.connectionId,
    uri: resource.uri,
    name: resource.name,
    description: typeof resource.description === 'string' ? resource.description : null,
    mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : null,
    meta: resource._meta ?? null,
  };
}

export function toTemplateRef(
  record: McpServerConfig,
  template: ResourceTemplate,
): McpResourceTemplateRef {
  return {
    serverId: record.serverId,
    connectionId: record.connectionId,
    uriTemplate: template.uriTemplate,
    name: template.name,
    description: typeof template.description === 'string' ? template.description : null,
    mimeType: typeof template.mimeType === 'string' ? template.mimeType : null,
    meta: template._meta ?? null,
  };
}

/**
 * Every resource template, or none from a server that does not implement
 * `resources/templates/list` (`-32601`); other failures stay failures.
 */
export async function listTemplatesOrNone(
  client: McpClient,
  options: McpRequestOptions,
): Promise<ResourceTemplate[]> {
  try {
    return await client.listResourceTemplates(options);
  } catch (error) {
    if (error instanceof McpRpcError && error.code === JSON_RPC_ERROR_CODES.methodNotFound) {
      return [];
    }
    throw error;
  }
}

/** A prompt of `prompts/list`, checked and reduced to the fields the app reads. */
export interface RawPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments: { name: string; description?: string; required?: boolean }[];
  _meta?: Record<string, unknown>;
}

export function toPromptRef(record: McpServerConfig, prompt: RawPrompt): McpPromptRef {
  return {
    serverId: record.serverId,
    connectionId: record.connectionId,
    name: prompt.name,
    title: prompt.title ?? null,
    description: prompt.description ?? null,
    args: prompt.arguments.map((argument) => ({
      name: argument.name,
      description: argument.description ?? null,
      required: argument.required ?? null,
    })),
    meta: prompt._meta ?? null,
  };
}

/**
 * Every prompt, following `nextCursor` through all pages. Like pi-mcp's own lists, a page or an
 * entry of the wrong shape fails the whole list, a repeated cursor is refused and at most 1000
 * pages are read, so a server that never ends its list cannot hold a request open.
 */
export async function listAllPrompts(
  client: McpClient,
  options: McpRequestOptions,
): Promise<RawPrompt[]> {
  const prompts: RawPrompt[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const params = cursor === undefined ? undefined : { cursor };
    const result = readPromptsPage(await client.request('prompts/list', params, options));
    prompts.push(...result.prompts);
    if (result.nextCursor === undefined) return prompts;
    if (cursors.has(result.nextCursor)) {
      throw new Error('MCP prompts/list returned a cursor it had already returned');
    }
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error(`MCP prompts/list exceeded ${MAX_LIST_PAGES} pages`);
}

/**
 * The tools and the tool, resource and prompt counts of a freshly connected client, each only
 * when the server advertises the capability. A tools failure fails the connect. A resources or
 * prompts failure counts zero (the server still connects), except an aborted request or an
 * authentication error, which propagate.
 */
export const countCatalog: McpCatalogCounter = async (client, signal) => {
  const options = withSignal(signal);
  const capabilities = client.serverCapabilities;
  const [tools, resources, prompts] = await Promise.all([
    capabilities?.tools ? client.listTools(options) : [],
    capabilities?.resources ? optionalCount(() => client.listResources(options), signal) : 0,
    capabilities?.prompts ? optionalCount(() => listAllPrompts(client, options), signal) : 0,
  ]);
  return { counts: { tools: tools.length, resources, prompts }, tools };
};

async function optionalCount(
  list: () => Promise<readonly unknown[]>,
  signal: AbortSignal | undefined,
): Promise<number> {
  try {
    return (await list()).length;
  } catch (error) {
    if (signal?.aborted || isUnauthorized(error)) throw error;
    return 0;
  }
}

function invalid(message: string): McpRpcError {
  return new McpRpcError(JSON_RPC_ERROR_CODES.invalidRequest, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPromptsPage(value: unknown): { prompts: RawPrompt[]; nextCursor?: string } {
  const items = isRecord(value) ? value['prompts'] : undefined;
  if (!isRecord(value) || !Array.isArray(items)) throw invalid('Invalid MCP prompts/list result');
  const prompts = items.map((item) => {
    const prompt = readPrompt(item);
    if (!prompt) throw invalid('Invalid entry in MCP prompts/list result');
    return prompt;
  });
  const nextCursor = value['nextCursor'];
  if (nextCursor === undefined) return { prompts };
  if (typeof nextCursor !== 'string') throw invalid('Invalid MCP prompts/list cursor');
  return { prompts, nextCursor };
}

/** A prompt with a name and well-formed arguments, else null; mistyped optional fields drop. */
function readPrompt(value: unknown): RawPrompt | null {
  if (!isRecord(value) || typeof value['name'] !== 'string') return null;
  const listed = value['arguments'] ?? [];
  if (!Array.isArray(listed)) return null;
  const promptArguments: RawPrompt['arguments'] = [];
  for (const argument of listed) {
    if (!isRecord(argument) || typeof argument['name'] !== 'string') return null;
    promptArguments.push({
      name: argument['name'],
      ...(typeof argument['description'] === 'string'
        ? { description: argument['description'] }
        : {}),
      ...(typeof argument['required'] === 'boolean' ? { required: argument['required'] } : {}),
    });
  }
  return {
    name: value['name'],
    ...(typeof value['title'] === 'string' ? { title: value['title'] } : {}),
    ...(typeof value['description'] === 'string' ? { description: value['description'] } : {}),
    arguments: promptArguments,
    ...(isRecord(value['_meta']) ? { _meta: value['_meta'] } : {}),
  };
}
