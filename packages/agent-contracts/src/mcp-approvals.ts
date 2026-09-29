import { Type, type Static } from 'typebox';
import { McpServerIdSchema, McpServerStatusSchema } from './mcp.js';

/**
 * Launch approvals (G1). An MCP server that runs a local command (every stdio server, user or
 * plugin) or whose bearer token reads a service env var (`tokenEnv`) is refused until the user
 * approves it as it stands. An approval binds a fingerprint of everything that decides what runs
 * or where the env value goes; any change to those voids it. Granting happens only through
 * shell-only routes, after a native confirmation in the shell (Swift or Electron main), or through
 * the CLI; the renderer may only withdraw.
 *
 * Routes (exposure in brackets, see agent-service `route-exposure.ts`):
 * - `GET    /v1/admin/approvals/mcp/:serverId`  [shell]    → McpLaunchApprovalDetails
 * - `POST   /v1/admin/approvals/mcp`            [shell]    McpLaunchApproveRequest → McpLaunchApproveResponse
 * - `DELETE /v1/mcp/servers/:serverId/approval` [renderer] → McpStatusResponse
 * - `POST   /v1/mcp/approvals/notice/dismiss`   [renderer] → McpStatusResponse
 * - `GET    /v1/mcp/status`                     [renderer] → McpStatusResponse
 *
 * `serverId` is the MCP server id (`McpServerIdSchema`): a user server's own id, or
 * `<plugin>:<server>` for a plugin server; URL-encode it in paths. Refusals: a launch or connect of
 * an unapproved server answers 403 `approval_required`; an approve whose fingerprint no longer
 * matches answers 409 `approval_changed` and stores nothing; a server that needs no approval
 * answers 400 `bad_request`.
 */

/**
 * - `notRequired`: HTTP without an env-sourced token; it never needs approval.
 * - `required`: never approved (or the approval was withdrawn).
 * - `changed`: approved once, but what it launches changed since.
 * - `approved`: approved as it stands.
 */
export const McpLaunchApprovalStateSchema = Type.Union([
  Type.Literal('notRequired'),
  Type.Literal('required'),
  Type.Literal('changed'),
  Type.Literal('approved'),
]);
export type McpLaunchApprovalState = Static<typeof McpLaunchApprovalStateSchema>;

export const McpLaunchKindSchema = Type.Union([
  Type.Literal('mcp-stdio'),
  Type.Literal('mcp-http-env'),
]);
export type McpLaunchKind = Static<typeof McpLaunchKindSchema>;

/** Who confirmed an approval: the Swift shell, Electron main, or the CLI prompt. */
export const McpLaunchApprovalViaSchema = Type.Union([
  Type.Literal('shell'),
  Type.Literal('electron'),
  Type.Literal('cli'),
]);
export type McpLaunchApprovalVia = Static<typeof McpLaunchApprovalViaSchema>;

export const McpServerLayerSchema = Type.Union([Type.Literal('user'), Type.Literal('plugin')]);
export type McpServerLayer = Static<typeof McpServerLayerSchema>;

/** HMAC-SHA256 hex digest; opaque to clients, which only echo it back. */
export const McpLaunchFingerprintSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });

/** One stored approval (`<dataDir>/security/launch-approvals.json`). */
export const McpLaunchApprovalRecordSchema = Type.Object(
  {
    v: Type.Literal(1),
    kind: McpLaunchKindSchema,
    serverId: McpServerIdSchema,
    layer: McpServerLayerSchema,
    /** A plugin server's plugin at approval time; `resolved` is its pinned source. */
    plugin: Type.Optional(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 128 }),
          revision: Type.String({ maxLength: 64 }),
          resolved: Type.String({ maxLength: 4096 }),
        },
        { additionalProperties: false },
      ),
    ),
    fingerprint: McpLaunchFingerprintSchema,
    approvedAt: Type.String({ maxLength: 64 }),
    via: McpLaunchApprovalViaSchema,
  },
  { additionalProperties: false },
);
export type McpLaunchApprovalRecord = Static<typeof McpLaunchApprovalRecordSchema>;

/**
 * One env entry of a stdio launch. Values are never returned: the dialog shows the key and the
 * value's length. `risky` marks keys that change what the runtime loads or where it looks
 * (`NODE_OPTIONS`, `DYLD_*`, `LD_*`, `PYTHONPATH`, `PATH`, and similar).
 */
export const McpLaunchEnvEntrySchema = Type.Object(
  {
    key: Type.String({ maxLength: 1024 }),
    sensitive: Type.Literal(true),
    length: Type.Integer({ minimum: 0 }),
    risky: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type McpLaunchEnvEntry = Static<typeof McpLaunchEnvEntrySchema>;

/** What an approval would allow, as the native confirmation shows it. */
export const McpLaunchApprovalDetailsSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    /** The server's own name: the plugin-local name of a plugin server, else `serverId`. */
    name: Type.String({ maxLength: 256 }),
    layer: McpServerLayerSchema,
    kind: McpLaunchKindSchema,
    /** Never `notRequired`: such a server has no details (400). */
    state: McpLaunchApprovalStateSchema,
    plugin: Type.Union([
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 128 }),
          name: Type.String({ maxLength: 256 }),
          version: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
          /** `npm <name>@<version>`, `git <url>@<commit>` or `local <path>`. */
          source: Type.String({ maxLength: 4096 }),
          revision: Type.String({ maxLength: 64 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    stdio: Type.Union([
      Type.Object(
        {
          command: Type.String({ maxLength: 1024 }),
          /** The executable the command resolves to now (PATH, cwd); what actually runs. */
          resolvedCommand: Type.String({ maxLength: 4096 }),
          args: Type.Array(Type.String({ maxLength: 4096 })),
          /** Absolute working directory the process starts in. */
          cwd: Type.String({ maxLength: 4096 }),
          /** Whether the process inherits the service environment beyond `env`. */
          inheritEnv: Type.Boolean(),
          env: Type.Array(McpLaunchEnvEntrySchema),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    http: Type.Union([
      Type.Object(
        {
          url: Type.String({ maxLength: 2048 }),
          /** The service env var whose value is sent as the bearer token. */
          tokenEnv: Type.String({ maxLength: 256 }),
          headerKeys: Type.Array(Type.String({ maxLength: 1024 })),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    /** Echo it in the approve request; the service recomputes and compares. */
    fingerprint: McpLaunchFingerprintSchema,
  },
  { additionalProperties: false },
);
export type McpLaunchApprovalDetails = Static<typeof McpLaunchApprovalDetailsSchema>;

export const McpLaunchApproveRequestSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    fingerprint: McpLaunchFingerprintSchema,
    via: McpLaunchApprovalViaSchema,
  },
  { additionalProperties: false },
);
export type McpLaunchApproveRequest = Static<typeof McpLaunchApproveRequestSchema>;

export const McpLaunchApproveResponseSchema = Type.Object(
  { approval: McpLaunchApprovalRecordSchema },
  { additionalProperties: false },
);
export type McpLaunchApproveResponse = Static<typeof McpLaunchApproveResponseSchema>;

/**
 * A status row as `/v1/mcp/status` lists it: the connection status, the plugin that contributes
 * the server, and its launch approval. Plugin servers (`readOnly`) are configured by their plugin,
 * never through MCP writes.
 */
export const McpServerStatusRowSchema = Type.Object(
  {
    ...McpServerStatusSchema.properties,
    pluginId: Type.String({ minLength: 1, maxLength: 128 }),
    readOnly: Type.Boolean(),
    approval: McpLaunchApprovalStateSchema,
  },
  { additionalProperties: false },
);
export type McpServerStatusRow = Static<typeof McpServerStatusRowSchema>;

export const McpStatusResponseSchema = Type.Object(
  {
    servers: Type.Array(McpServerStatusRowSchema),
    /**
     * One-time notice: launch approvals were introduced and servers configured before them need
     * approving once. Stays true until dismissed (`POST /v1/mcp/approvals/notice/dismiss`).
     */
    approvalNotice: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type McpStatusResponse = Static<typeof McpStatusResponseSchema>;
