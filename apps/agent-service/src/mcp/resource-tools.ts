import { randomUUID } from 'node:crypto';
import { Type, type TSchema } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  errorMessage,
  parse,
  type McpCallResult,
  type McpContentBlock,
  type McpResourceRef,
  type McpResourceTemplateRef,
} from '@atd/agent-contracts';
import type { McpFacade } from './facade.js';
import { mapCallResult } from './mapping.js';
import { toPiContent } from './model-content.js';
import { FULL_JSON_KIND, limitText } from './text-limits.js';
import type { McpProxyDetails, McpProxyHost } from './tool-proxies.js';

/**
 * The model's MCP resource tools, under the names and JSON shapes of pi's (pi-coding-agent
 * `dist/extensions/mcp/resources.js`, which follows Codex and opencode): `list_mcp_resources`,
 * `list_mcp_resource_templates` and `read_mcp_resource`, each taking the server id as `server`.
 * They reach only the run's resource servers: those bound at its start whose settings expose
 * resources (`exposeResources`) and that offer them. Every request goes through the facade, so
 * reads keep its URI authorization, revision pin and audit, and what a read returns is mapped like
 * a tool result: blobs become artifacts and long text is cut, its whole text kept as one.
 *
 * Unlike pi's, listings are always complete (the facade reads every page), so they never return a
 * `nextCursor` and refuse a `cursor`. MCP App interfaces (`ui://` URIs, `profile=mcp-app`) are
 * left out, as pi leaves them out: only hosts that render them can use them.
 */

export const LIST_MCP_RESOURCES_TOOL = 'list_mcp_resources';
export const LIST_MCP_RESOURCE_TEMPLATES_TOOL = 'list_mcp_resource_templates';
export const READ_MCP_RESOURCE_TOOL = 'read_mcp_resource';
export const MCP_RESOURCE_TOOLS: readonly string[] = [
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
];

/** A server whose resources the run may list and read, pinned to its revision at bind. */
export interface McpResourceServer {
  serverId: string;
  revision: number;
}

const ListParameters = Type.Object(
  {
    server: Type.Optional(
      Type.String({ description: 'MCP server name. Omit to list every server with resources.' }),
    ),
    cursor: Type.Optional(
      Type.String({ description: 'Not used: listings here are always complete.' }),
    ),
  },
  { additionalProperties: false },
);

const ReadParameters = Type.Object(
  {
    server: Type.String({
      description:
        "MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources.",
    }),
    uri: Type.String({
      description: 'Resource URI to read. Must be one of the URIs returned by list_mcp_resources.',
    }),
  },
  { additionalProperties: false },
);

/**
 * What codemode scripts receive (`structuredContent`), declared as pi declares its resource tools'
 * output (pi-coding-agent `dist/extensions/mcp/resources.js`), less what these tools never return:
 * a listing has no `nextCursor`, a listed item no `title` or `size`, and a read content's binary
 * payload is an artifact, so it carries `blobBytes` instead of the base64 `blob`.
 */
const ListingErrors = Type.Optional(
  Type.Array(Type.Object({ server: Type.String(), error: Type.String() }), {
    description: 'Servers that could not be listed',
  }),
);
const ListedFields = {
  server: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  mimeType: Type.Optional(Type.String()),
};
const ListOutput = Type.Object({
  server: Type.Optional(Type.String()),
  resources: Type.Array(Type.Object({ ...ListedFields, uri: Type.String() })),
  errors: ListingErrors,
});
const ListTemplatesOutput = Type.Object({
  server: Type.Optional(Type.String()),
  resourceTemplates: Type.Array(
    Type.Object({
      ...ListedFields,
      uriTemplate: Type.String({ description: 'RFC 6570 URI template' }),
    }),
  ),
  errors: ListingErrors,
});
const ReadOutput = Type.Object({
  server: Type.String(),
  uri: Type.String(),
  contents: Type.Array(
    Type.Object({
      uri: Type.String(),
      mimeType: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      blobBytes: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: 'Size of binary content, which is saved as an artifact instead.',
        }),
      ),
    }),
  ),
});

type Listed = Record<string, string> & { server: string };
/** A listing as pi answers it: `{ server?, resources | resourceTemplates, errors? }`. */
type Listing = Record<string, string | Listed[] | Array<{ server: string; error: string }>>;

/** The three tools for `servers` (non-empty), registered beside the run's proxies. */
export function mcpResourceTools(
  host: McpProxyHost,
  facade: McpFacade,
  servers: readonly McpResourceServer[],
): ToolDefinition<TSchema, McpProxyDetails, unknown>[] {
  const ordered = [...servers].sort((a, b) => a.serverId.localeCompare(b.serverId));
  const find = (name: string) => {
    const server = ordered.find((candidate) => candidate.serverId === name);
    if (server) return server;
    const available = ordered.map((candidate) => candidate.serverId).join(', ');
    throw new Error(`MCP server "${name}" has no resources. Servers with resources: ${available}`);
  };
  /** One server's items, or every server's with the ones that failed under `errors`. */
  const list = async (
    params: { server?: string; cursor?: string },
    key: 'resources' | 'resourceTemplates',
    read: (serverId: string) => Promise<Listed[]>,
  ): Promise<Listing> => {
    if (params.cursor?.trim())
      throw new Error('Listings here are always complete; call again without a cursor.');
    const name = params.server?.trim();
    if (name) return { server: name, [key]: await read(find(name).serverId) };
    const results = await Promise.allSettled(ordered.map((server) => read(server.serverId)));
    const items: Listed[] = [];
    const errors: Array<{ server: string; error: string }> = [];
    results.forEach((result, index) => {
      const server = ordered[index]?.serverId ?? '';
      if (result.status === 'fulfilled') items.push(...result.value);
      else errors.push({ server, error: errorMessage(result.reason) });
    });
    return { [key]: items, ...(errors.length ? { errors } : {}) };
  };
  const listTool = (
    name: string,
    description: string,
    key: 'resources' | 'resourceTemplates',
    read: (serverId: string, signal?: AbortSignal) => Promise<Listed[]>,
  ): ToolDefinition<TSchema, McpProxyDetails, unknown> => ({
    name,
    label: name,
    description,
    parameters: ListParameters,
    outputSchema: key === 'resources' ? ListOutput : ListTemplatesOutput,
    annotations: { readOnlyHint: true },
    async execute(_id, args, signal) {
      const params = parse(ListParameters, args ?? {});
      const payload = await list(params, key, (serverId) => read(serverId, signal));
      const server = params.server?.trim() ?? '';
      const limited = await limitText(
        facade.mapping,
        JSON.stringify(payload),
        { serverId: server || 'mcp', tool: name, taskId: host.taskId },
        FULL_JSON_KIND,
        'application/json',
      );
      const attachments = limited.attachment ? [limited.attachment] : [];
      return {
        content: [{ type: 'text', text: limited.text }],
        details: details(server, name, { attachments, limitsNote: limited.note ?? '' }),
        structuredContent: payload,
      };
    },
  });
  const readTool: ToolDefinition<TSchema, McpProxyDetails, unknown> = {
    name: READ_MCP_RESOURCE_TOOL,
    label: READ_MCP_RESOURCE_TOOL,
    description:
      'Read a specific resource from an MCP server given the server name and resource URI.',
    parameters: ReadParameters,
    outputSchema: ReadOutput,
    annotations: { readOnlyHint: true },
    async execute(id, args, signal) {
      const params = parse(ReadParameters, args);
      const server = find(params.server.trim());
      const uri = params.uri.trim();
      if (!uri) throw new Error('uri must be provided');
      const op = {
        operationId: randomUUID(),
        taskId: host.taskId,
        runId: host.runId(),
        executionId: host.executionId(),
        toolCallId: id,
        configRevision: server.revision,
      };
      const read = await facade.readResource(op, server.serverId, uri, signal);
      const blocks: McpContentBlock[] = read.contents.map((resource) => ({
        type: 'resource',
        resource,
      }));
      const ctx = {
        serverId: server.serverId,
        tool: READ_MCP_RESOURCE_TOOL,
        uri,
        taskId: op.taskId,
      };
      const mapped = await mapCallResult(facade.mapping, { content: blocks }, ctx);
      // Several contents (a directory, say) are labeled with their URIs, as pi labels them; a
      // content mapping left out (an attachment note instead) would shift them, so none are then.
      const labels = read.contents.length > 1 && mapped.content.length === read.contents.length;
      const labeled: McpCallResult = {
        ...mapped,
        content: mapped.content.flatMap((block, index) => {
          const label = labels ? read.contents[index]?.uri : undefined;
          return label ? [{ type: 'text' as const, text: `${label}:` }, block] : [block];
        }),
      };
      return {
        content: read.contents.length
          ? toPiContent(labeled, (id) => facade.mapping.resources.pathOf(id))
          : [{ type: 'text', text: `Resource ${uri} is empty.` }],
        details: details(server.serverId, READ_MCP_RESOURCE_TOOL, mapped),
        // Blobs stay out: they are artifacts now, and the transcript keeps this object.
        structuredContent: {
          server: server.serverId,
          uri,
          contents: read.contents.map(({ blob, ...rest }) =>
            blob === undefined ? rest : { ...rest, blobBytes: Buffer.byteLength(blob, 'base64') },
          ),
        },
      };
    },
  };
  return [
    listTool(
      LIST_MCP_RESOURCES_TOOL,
      'Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.',
      'resources',
      async (serverId, signal) =>
        (await facade.listResources(serverId, signal, host.taskId))
          .filter((item) => !isMcpAppResource(item.uri, item.mimeType))
          .map((item) => listed(item, { uri: item.uri })),
    ),
    listTool(
      LIST_MCP_RESOURCE_TEMPLATES_TOOL,
      'Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.',
      'resourceTemplates',
      async (serverId, signal) =>
        (await facade.listResourceTemplates(serverId, signal, host.taskId))
          .filter((item) => !isMcpAppResource(item.uriTemplate, item.mimeType))
          .map((item) => listed(item, { uriTemplate: item.uriTemplate })),
    ),
    readTool,
  ];
}

/** MCP App user interfaces, which only hosts that render them can use (pi's `isMcpAppResource`). */
function isMcpAppResource(uri: string, mimeType: string | null): boolean {
  return uri.startsWith('ui://') || /;\s*profile\s*=\s*"?mcp-app"?/i.test(mimeType ?? '');
}

/** A listed resource or template as pi lists it: tagged with its server, without metadata. */
function listed(
  item: McpResourceRef | McpResourceTemplateRef,
  address: { uri: string } | { uriTemplate: string },
): Listed {
  return {
    server: item.serverId,
    ...address,
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    ...(item.mimeType ? { mimeType: item.mimeType } : {}),
  };
}

function details(
  server: string,
  tool: string,
  result: Pick<McpCallResult, 'attachments' | 'limitsNote'>,
): McpProxyDetails {
  return {
    server,
    tool,
    isError: false,
    attachments: result.attachments.map(({ artifactId, kind, note }) => ({
      artifactId,
      kind,
      note,
    })),
    limitsNote: result.limitsNote,
  };
}
