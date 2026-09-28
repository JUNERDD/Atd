import { QualifiedNameSchema } from '@ai/plugin-kit/model';
import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * T4 MCP contracts (freeze candidate `mcp v1`, owned by root). Wire DTOs
 * for the single MCP authority. Responses are plain types (constructed by
 * the service); route request bodies live service-side in mcp/requests.ts
 * until root freezes their placement.
 */

/**
 * MCP server id. A server the user configures keeps the identifier alphabet it always had; a
 * server an installed plugin contributes is `<plugin>:<server>` (plugin-kit's qualified name).
 * `connectionId` stays an `Identifier`; capability ids (`mcpCapabilityId`) key on it, so a `:` in
 * the server id never reaches them. Anything that embeds the server id in a colon-delimited key or
 * a file name must encode it.
 */
export const McpServerIdSchema = Type.Union([Identifier, QualifiedNameSchema]);
export type McpServerId = Static<typeof McpServerIdSchema>;

export const McpConnectionStateSchema = Type.Union([
  Type.Literal('disabled'),
  Type.Literal('disconnected'),
  Type.Literal('connecting'),
  Type.Literal('auth_required'),
  Type.Literal('ready'),
  Type.Literal('error'),
  Type.Literal('closing'),
]);
export type McpConnectionState = Static<typeof McpConnectionStateSchema>;

export const McpTransportKindSchema = Type.Union([
  Type.Literal('stdio'),
  Type.Literal('streamable-http'),
  Type.Literal('sse'),
]);
export type McpTransportKind = Static<typeof McpTransportKindSchema>;

export const McpStdioSchema = Type.Object(
  {
    command: Type.String({ minLength: 1, maxLength: 1024 }),
    args: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 }),
    env: Type.Record(Type.String(), Type.String({ maxLength: 8192 })),
    cwd: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type McpStdio = Static<typeof McpStdioSchema>;

const NoneAuth = Type.Object({ type: Type.Literal('none') }, { additionalProperties: false });
const BearerAuth = Type.Object(
  { type: Type.Literal('bearer'), tokenEnv: Type.String({ maxLength: 256 }) },
  { additionalProperties: false },
);
const OAuthAuth = Type.Object(
  {
    type: Type.Literal('oauth'),
    scope: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
    redirectUri: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const McpHttpAuthSchema = Type.Union([NoneAuth, BearerAuth, OAuthAuth]);
export type McpHttpAuth = Static<typeof McpHttpAuthSchema>;

export const McpHttpSchema = Type.Object(
  {
    url: Type.String({ minLength: 1, maxLength: 2048 }),
    transport: Type.Union([Type.Literal('streamable-http'), Type.Literal('sse')]),
    headers: Type.Record(Type.String(), Type.String({ maxLength: 8192 })),
    auth: McpHttpAuthSchema,
  },
  { additionalProperties: false },
);
export type McpHttp = Static<typeof McpHttpSchema>;

export const McpServerConfigSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    revision: Type.Integer({ minimum: 1 }),
    connectionId: Identifier,
    transport: McpTransportKindSchema,
    stdio: Type.Union([McpStdioSchema, Type.Null()]),
    http: Type.Union([McpHttpSchema, Type.Null()]),
    principal: Type.String({ maxLength: 256 }),
    isolateByTask: Type.Boolean(),
    exposeResources: Type.Boolean(),
    approveTools: Type.Union([Type.Boolean(), Type.Array(Type.String({ maxLength: 256 }))]),
    includeTools: Type.Array(Type.String({ maxLength: 256 })),
    excludeTools: Type.Array(Type.String({ maxLength: 256 })),
    requestTimeoutMs: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    disabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type McpServerConfig = Static<typeof McpServerConfigSchema>;

export const McpServerStatusSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    connectionId: Identifier,
    configRevision: Type.Integer({ minimum: 1 }),
    state: McpConnectionStateSchema,
    toolCount: Type.Integer({ minimum: 0 }),
    resourceCount: Type.Integer({ minimum: 0 }),
    promptCount: Type.Integer({ minimum: 0 }),
    disabled: Type.Boolean(),
    lastError: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type McpServerStatus = Static<typeof McpServerStatusSchema>;

/**
 * A status row as `/v1/mcp/status` lists it: the connection status plus the plugin that contributes
 * the server. Plugin servers (`readOnly`) are configured by their plugin, never through MCP writes.
 */
export const McpServerStatusRowSchema = Type.Object(
  {
    ...McpServerStatusSchema.properties,
    pluginId: Type.String({ minLength: 1, maxLength: 128 }),
    readOnly: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type McpServerStatusRow = Static<typeof McpServerStatusRowSchema>;

export interface McpStatusResponse {
  servers: McpServerStatusRow[];
}

export const McpToolRefSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    connectionId: Identifier,
    name: Type.String({ maxLength: 256 }),
    title: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    description: Type.Union([Type.String({ maxLength: 8000 }), Type.Null()]),
    inputSchema: Type.Unknown(),
    outputSchema: Type.Unknown(),
    meta: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type McpToolRef = Static<typeof McpToolRefSchema>;

export const McpResourceRefSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    connectionId: Identifier,
    uri: Type.String({ maxLength: 2048 }),
    name: Type.String({ maxLength: 256 }),
    description: Type.Union([Type.String({ maxLength: 8000 }), Type.Null()]),
    mimeType: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    meta: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type McpResourceRef = Static<typeof McpResourceRefSchema>;

export const McpResourceTemplateRefSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    connectionId: Identifier,
    uriTemplate: Type.String({ maxLength: 2048 }),
    name: Type.String({ maxLength: 256 }),
    description: Type.Union([Type.String({ maxLength: 8000 }), Type.Null()]),
    mimeType: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    meta: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type McpResourceTemplateRef = Static<typeof McpResourceTemplateRefSchema>;

export const McpPromptArgumentSchema = Type.Object(
  {
    name: Type.String({ maxLength: 256 }),
    description: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    required: Type.Union([Type.Boolean(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type McpPromptArgument = Static<typeof McpPromptArgumentSchema>;

export const McpPromptRefSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    connectionId: Identifier,
    name: Type.String({ maxLength: 256 }),
    title: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    description: Type.Union([Type.String({ maxLength: 8000 }), Type.Null()]),
    args: Type.Array(McpPromptArgumentSchema),
    meta: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type McpPromptRef = Static<typeof McpPromptRefSchema>;

const TextBlock = Type.Object(
  { type: Type.Literal('text'), text: Type.String() },
  { additionalProperties: false },
);
const ImageBlock = Type.Object(
  { type: Type.Literal('image'), data: Type.String(), mimeType: Type.String() },
  { additionalProperties: false },
);
const AudioBlock = Type.Object(
  { type: Type.Literal('audio'), data: Type.String(), mimeType: Type.String() },
  { additionalProperties: false },
);
const ResourceBlock = Type.Object(
  {
    type: Type.Literal('resource'),
    resource: Type.Object(
      {
        uri: Type.String(),
        text: Type.Optional(Type.String()),
        blob: Type.Optional(Type.String()),
        mimeType: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const ResourceLinkBlock = Type.Object(
  {
    type: Type.Literal('resource_link'),
    uri: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const McpContentBlockSchema = Type.Union([
  TextBlock,
  ImageBlock,
  AudioBlock,
  ResourceBlock,
  ResourceLinkBlock,
]);
export type McpContentBlock = Static<typeof McpContentBlockSchema>;

export const McpPromptMessageSchema = Type.Object(
  {
    role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
    content: McpContentBlockSchema,
  },
  { additionalProperties: false },
);
export type McpPromptMessage = Static<typeof McpPromptMessageSchema>;

export const McpAttachmentSchema = Type.Object(
  {
    artifactId: Type.Union([Identifier, Type.Null()]),
    kind: Type.String({ maxLength: 64 }),
    mimeType: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    name: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    note: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type McpAttachment = Static<typeof McpAttachmentSchema>;

export const McpCallResultSchema = Type.Object(
  {
    content: Type.Array(McpContentBlockSchema),
    structuredContent: Type.Unknown(),
    isError: Type.Boolean(),
    attachments: Type.Array(McpAttachmentSchema),
    limitsNote: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type McpCallResult = Static<typeof McpCallResultSchema>;

const ResourceContent = Type.Object(
  {
    uri: Type.String(),
    text: Type.Optional(Type.String()),
    blob: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const McpReadResourceResponseSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    uri: Type.String({ maxLength: 2048 }),
    contents: Type.Array(ResourceContent),
  },
  { additionalProperties: false },
);
export type McpReadResourceResponse = Static<typeof McpReadResourceResponseSchema>;

export const McpGetPromptResponseSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    name: Type.String({ maxLength: 256 }),
    description: Type.Union([Type.String({ maxLength: 8000 }), Type.Null()]),
    messages: Type.Array(McpPromptMessageSchema),
  },
  { additionalProperties: false },
);
export type McpGetPromptResponse = Static<typeof McpGetPromptResponseSchema>;

export type McpApprovalDecision = 'allow_once' | 'deny';

export interface McpAuthStartResponse {
  serverId: string;
  authenticated: boolean;
  authorizationUrl: string | null;
  mode: 'oauth' | 'manual-redirect';
}

export interface McpAuthCompleteResponse {
  serverId: string;
  authenticated: boolean;
}

export interface McpAuthUrlNotice {
  text: string;
  kind: 'info';
  mcp: { type: 'auth_url'; serverId: string; authorizationUrl: string };
}

export interface McpSnapshot {
  revision: number;
  servers: McpServerStatus[];
}

/** D8 dynamic capability identity: `mcp:tool:<connectionId>:<tool>`. */
export function mcpCapabilityId(connectionId: string, toolName: string): string {
  return `mcp:tool:${connectionId}:${toolName}`;
}

export function parseMcpCapabilityId(value: string): {
  connectionId: string;
  toolName: string;
} | null {
  const m = /^mcp:tool:([a-zA-Z0-9_-]+):(.+)$/.exec(value);
  return m?.[1] && m[2] ? { connectionId: m[1], toolName: m[2] } : null;
}
