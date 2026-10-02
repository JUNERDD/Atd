import { Type, type Static } from 'typebox';

/**
 * How an MCP server over HTTP authenticates (part of `McpServerConfig`, mcp.ts). Credentials never
 * appear in these shapes as clients read them: a bearer token comes from an env var or the OS
 * keyring, and a client secret reads back as `{ set: true }` (mcp-servers.ts).
 */

export const McpNoneAuthSchema = Type.Object(
  { type: Type.Literal('none') },
  { additionalProperties: false },
);
export const McpBearerAuthSchema = Type.Object(
  { type: Type.Literal('bearer'), tokenEnv: Type.String({ maxLength: 256 }) },
  { additionalProperties: false },
);
/**
 * The OAuth client a server's sign-in uses, for servers that do not support dynamic client
 * registration or advertise the wrong authorization server (pi's `McpOAuthConfig`). Every field is
 * optional: without `clientId` the service registers a client itself. Only the user's settings and
 * installed plugins set these; the model's `configure_mcp` cannot.
 */
export const McpOAuthClientSchema = Type.Object(
  {
    /** A pre-registered client id. */
    clientId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    /** `client_name` sent with dynamic client registration; the service's own name by default. */
    clientName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    /** Fixed port of the loopback callback, for a client registered with that redirect URI. */
    callbackPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    /**
     * Authorization server metadata (RFC 8414 or OpenID discovery) used instead of discovery
     * through the server. It decides where codes, tokens and the client secret go, so it must use
     * https except on loopback hosts, and it is part of a launch approval's fingerprint.
     */
    authServerMetadataUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  },
  { additionalProperties: false },
);
export type McpOAuthClient = Static<typeof McpOAuthClientSchema>;

export const McpOAuthAuthSchema = Type.Object(
  {
    type: Type.Literal('oauth'),
    scope: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
    redirectUri: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
    ...McpOAuthClientSchema.properties,
    /**
     * The pre-registered client's secret. Service-side records hold the value (the OS keyring
     * keeps it at rest, like header values); a client read shows only that it is set.
     */
    clientSecret: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
  },
  { additionalProperties: false },
);
/**
 * How an HTTP server authenticates. `none` still offers OAuth when the server answers 401 and the
 * record configures no `Authorization` header, as pi's MCP client does.
 */
export const McpHttpAuthSchema = Type.Union([
  McpNoneAuthSchema,
  McpBearerAuthSchema,
  McpOAuthAuthSchema,
]);
export type McpHttpAuth = Static<typeof McpHttpAuthSchema>;
export type McpOAuthAuth = Static<typeof McpOAuthAuthSchema>;
