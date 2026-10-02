import { Type, type Static } from 'typebox';
import {
  McpBearerAuthSchema,
  McpNoneAuthSchema,
  McpOAuthAuthSchema,
  McpOAuthClientSchema,
} from './mcp-auth.js';
import {
  McpHttpSchema,
  McpServerConfigSchema,
  McpServerExposureSchema,
  McpStdioSchema,
  McpTransportKindSchema,
} from './mcp.js';

/**
 * The user's MCP servers as clients read and edit them (`/v1/mcp/servers`). Reads never carry a
 * stdio env or HTTP header value or an OAuth client secret: those are credentials, and no client
 * needs them back, so a view names each entry and says only that it is set. Edits send new values or keep stored ones
 * by name, and the service merges them (agent-service `mcp/server-edits.ts`).
 *
 * - `GET    /v1/mcp/servers`                    → McpServersResponse
 * - `PUT    /v1/mcp/servers/:serverId`          McpServerUpsertRequest → McpServersResponse
 * - `POST   /v1/mcp/servers/:serverId/enabled`  McpServerEnabledRequest → McpServersResponse
 * - `DELETE /v1/mcp/servers/:serverId`          → McpServersResponse
 */

/** A stored env or header value as a read shows it. */
export const McpSecretSetSchema = Type.Object(
  { set: Type.Literal(true) },
  { additionalProperties: false },
);
export type McpSecretSet = Static<typeof McpSecretSetSchema>;

const SecretNamesSchema = Type.Record(Type.String(), McpSecretSetSchema);

export const McpStdioViewSchema = Type.Object(
  { ...McpStdioSchema.properties, env: SecretNamesSchema },
  { additionalProperties: false },
);
export type McpStdioView = Static<typeof McpStdioViewSchema>;

/** HTTP auth as a read shows it: an OAuth client secret only as `{ set: true }`. */
export const McpHttpAuthViewSchema = Type.Union([
  McpNoneAuthSchema,
  McpBearerAuthSchema,
  Type.Object(
    { ...McpOAuthAuthSchema.properties, clientSecret: Type.Optional(McpSecretSetSchema) },
    { additionalProperties: false },
  ),
]);
export type McpHttpAuthView = Static<typeof McpHttpAuthViewSchema>;

export const McpHttpViewSchema = Type.Object(
  { ...McpHttpSchema.properties, headers: SecretNamesSchema, auth: McpHttpAuthViewSchema },
  { additionalProperties: false },
);
export type McpHttpView = Static<typeof McpHttpViewSchema>;

/** A user server record with every env, header and client secret value redacted to `{ set: true }`. */
export const McpServerViewSchema = Type.Object(
  {
    ...McpServerConfigSchema.properties,
    stdio: Type.Union([McpStdioViewSchema, Type.Null()]),
    http: Type.Union([McpHttpViewSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type McpServerView = Static<typeof McpServerViewSchema>;

export const McpServersResponseSchema = Type.Object(
  { servers: Type.Array(McpServerViewSchema) },
  { additionalProperties: false },
);
export type McpServersResponse = Static<typeof McpServersResponseSchema>;

/** A value to store, or `{ keep: true }` for the value already stored under the same name. */
export const McpSecretInputSchema = Type.Union([
  Type.String({ maxLength: 8192 }),
  Type.Object({ keep: Type.Literal(true) }, { additionalProperties: false }),
]);
export type McpSecretInput = Static<typeof McpSecretInputSchema>;

/**
 * The OAuth client of an edit. Sent, it is the whole new client: a field it leaves out is cleared,
 * and `clientSecret` is a new value or `{ keep: true }` for the stored one, which is refused when
 * the client id, the authorization server metadata URL or the URL origin changes.
 */
export const McpOAuthClientDraftSchema = Type.Object(
  { ...McpOAuthClientSchema.properties, clientSecret: Type.Optional(McpSecretInputSchema) },
  { additionalProperties: false },
);
export type McpOAuthClientDraft = Static<typeof McpOAuthClientDraftSchema>;

/**
 * HTTP auth as an edit names it. An OAuth server keeps its stored scope and redirect URI, and its
 * stored client unless `client` is sent.
 */
export const McpAuthDraftSchema = Type.Union([
  Type.Object({ type: Type.Literal('none') }, { additionalProperties: false }),
  Type.Object(
    { type: Type.Literal('bearer'), tokenEnv: Type.String({ minLength: 1, maxLength: 256 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('oauth'), client: Type.Optional(McpOAuthClientDraftSchema) },
    { additionalProperties: false },
  ),
]);
export type McpAuthDraft = Static<typeof McpAuthDraftSchema>;

/**
 * Adds or updates one user server. The transport, command and args or URL, and auth replace the
 * stored ones; `exposure` and `exposeResources` replace them when sent; everything else a stored
 * server has (working directory, OAuth scope, tool settings, enabled state) is kept. A new server
 * starts with `exposure: 'auto'` and `exposeResources: false`. `env` (stdio) and `headers` (HTTP) merge by name:
 *
 * - an omitted map keeps every stored entry of the same kind of transport;
 * - a sent map is the whole new set, so a stored name it leaves out is cleared;
 * - `{ keep: true }` keeps the stored value of that exact name, and is refused for any other;
 * - a rename is the old name left out and the new name sent with a value.
 *
 * Kept secrets never move to another destination: a kept header or bearer credential refuses a
 * URL on another origin, and a kept env entry refuses another command.
 */
export const McpServerUpsertRequestSchema = Type.Object(
  {
    transport: McpTransportKindSchema,
    command: Type.Optional(Type.String({ maxLength: 1024 })),
    args: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 })),
    url: Type.Optional(Type.String({ maxLength: 2048 })),
    auth: McpAuthDraftSchema,
    env: Type.Optional(Type.Record(Type.String(), McpSecretInputSchema)),
    headers: Type.Optional(Type.Record(Type.String(), McpSecretInputSchema)),
    exposure: Type.Optional(McpServerExposureSchema),
    exposeResources: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type McpServerUpsertRequest = Static<typeof McpServerUpsertRequestSchema>;

export const McpServerEnabledRequestSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);
export type McpServerEnabledRequest = Static<typeof McpServerEnabledRequestSchema>;
