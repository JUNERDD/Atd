import { Type, type Static } from 'typebox';
import { AddonErrorCodeSchema } from './addons.js';
import {
  BoundedLogRingSchema,
  DiagnosticMachineCodeSchema,
  LaunchApprovalKeyStateSchema,
} from './diagnostics.js';
import { Identifier } from './identifiers.js';

/**
 * Shell-only allowlisted projection schemas for `GET /v1/admin/diagnostics/snapshot` (`SHELL_ROUTE`).
 * Never exposed through `APIRelay` to the renderer; strips prompts, clipboard, env/header values,
 * credentials, and personal file paths at serialization time before Swift's 5-pass scrubber runs.
 */

export const ProviderBaseUrlShapeSchema = Type.Object(
  {
    customHost: Type.Boolean(),
    scheme: Type.Union([
      Type.Literal('http'),
      Type.Literal('https'),
      Type.Literal('invalid'),
      Type.Null(),
    ]),
    loopback: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ProviderBaseUrlShape = Static<typeof ProviderBaseUrlShapeSchema>;

export const ProviderDiagnosticProjectionSchema = Type.Object(
  {
    /** First 8 lowercase hex characters of `SHA-256(connectionId)` for intra-snapshot correlation. */
    connectionIdHash: Type.String({ minLength: 8, maxLength: 8, pattern: '^[0-9a-f]{8}$' }),
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    authType: Type.Union([
      Type.Literal('api_key'),
      Type.Literal('oauth'),
      Type.Literal('none'),
      Type.Literal('ambient'),
    ]),
    connected: Type.Boolean(),
    hasCredential: Type.Boolean(),
    credentialIssue: Type.Union([
      Type.Literal('credential_unreadable'),
      Type.Literal('credential_missing'),
      Type.Null(),
    ]),
    baseUrlShape: ProviderBaseUrlShapeSchema,
    modelCheckStatus: Type.Union([
      Type.Literal('ok'),
      Type.Literal('failed'),
      Type.Literal('unverified'),
    ]),
    /** Categorized failure code from the latest connection or model check for offline bundles. */
    lastErrorCategory: Type.Union([DiagnosticMachineCodeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderDiagnosticProjection = Static<typeof ProviderDiagnosticProjectionSchema>;

export const McpDiagnosticProjectionSchema = Type.Object(
  {
    serverId: Type.String({ minLength: 1, maxLength: 193 }),
    transport: Type.Union([
      Type.Literal('stdio'),
      Type.Literal('sse'),
      Type.Literal('streamable-http'),
    ]),
    state: Type.String({ maxLength: 32 }),
    approval: Type.String({ maxLength: 32 }),
    /** Key counts only; env and header values are never serialized. */
    envKeyCount: Type.Integer({ minimum: 0, maximum: 256 }),
    headerKeyCount: Type.Integer({ minimum: 0, maximum: 256 }),
    lastErrorCode: Type.Union([DiagnosticMachineCodeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type McpDiagnosticProjection = Static<typeof McpDiagnosticProjectionSchema>;

export const AddonDiagnosticProjectionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    available: Type.Boolean(),
    phase: Type.String({ maxLength: 32 }),
    installedVersion: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    outdatedVersion: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    /** Strips personal filesystem paths from `AddonView.installed.{root,entries}`. */
    errorCode: Type.Union([AddonErrorCodeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type AddonDiagnosticProjection = Static<typeof AddonDiagnosticProjectionSchema>;

export const RunPrepDecisionEntrySchema = Type.Object(
  {
    seq: Type.Integer({ minimum: 1 }),
    ts: Type.String({ maxLength: 64 }),
    /** First 8 characters of `runId` to correlate with `recentRuns` without session paths. */
    runIdPrefix: Type.String({ minLength: 1, maxLength: 16 }),
    phase: Type.String({ minLength: 1, maxLength: 64 }),
    durationMs: Type.Integer({ minimum: 0 }),
    outcome: Type.Union([
      Type.Literal('completed'),
      Type.Literal('error'),
      Type.Literal('stopped'),
      Type.Literal('no_turn'),
      Type.Literal('degraded'),
    ]),
    reasonCode: Type.Union([DiagnosticMachineCodeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type RunPrepDecisionEntry = Static<typeof RunPrepDecisionEntrySchema>;

export const RecentRunDiagnosticProjectionSchema = Type.Object(
  {
    runIdPrefix: Type.String({ minLength: 1, maxLength: 16 }),
    createdAt: Type.String({ maxLength: 64 }),
    status: Type.String({ maxLength: 32 }),
    triggerKind: Type.String({ maxLength: 32 }),
    /** Categorized error code only; raw `run.error` messages are excluded. */
    errorCategory: Type.Union([DiagnosticMachineCodeSchema, Type.Null()]),
    degradedFlags: Type.Object(
      {
        pluginsDegraded: Type.Boolean(),
        memoryDegraded: Type.Boolean(),
        catalogError: Type.Boolean(),
        mcpStrippedForUnattended: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type RecentRunDiagnosticProjection = Static<typeof RecentRunDiagnosticProjectionSchema>;

/** Response body for `GET /v1/admin/diagnostics/snapshot` (`SHELL_ROUTE`). */
export const ServiceDiagnosticsSnapshotSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    capturedAt: Type.String({ maxLength: 64 }),
    service: Type.Object(
      {
        serviceId: Identifier,
        protocolVersion: Type.String({ maxLength: 16 }),
        epoch: Type.Integer({ minimum: 0 }),
        startedAt: Type.String({ maxLength: 64 }),
        nodeVersion: Type.String({ maxLength: 32 }),
        arch: Type.String({ maxLength: 16 }),
        platform: Type.String({ maxLength: 16 }),
        pid: Type.Integer({ minimum: 1 }),
        uptimeMs: Type.Integer({ minimum: 0 }),
        draining: Type.Boolean(),
        activeRuns: Type.Integer({ minimum: 0 }),
        pendingConfirms: Type.Integer({ minimum: 0 }),
        pendingCapabilities: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    environmentSummary: Type.Object(
      {
        loginShellResolved: Type.Boolean(),
        loginShellDurationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        loginShellFallbackReason: Type.Union([DiagnosticMachineCodeSchema, Type.Null()]),
        pathEntryCount: Type.Integer({ minimum: 0, maximum: 512 }),
        hasHomebrewPath: Type.Boolean(),
        hasUsrLocalPath: Type.Boolean(),
        systemProxyMode: Type.Union([
          Type.Literal('direct'),
          Type.Literal('http'),
          Type.Literal('env_override'),
          Type.Literal('skipped_invalid'),
        ]),
        skippedProxyBypassCount: Type.Integer({ minimum: 0 }),
        hasNodeExtraCaCerts: Type.Boolean(),
        nodeUseSystemCa: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    providers: Type.Array(ProviderDiagnosticProjectionSchema, { maxItems: 64 }),
    mcp: Type.Object(
      {
        launchApprovalKeyState: LaunchApprovalKeyStateSchema,
        servers: Type.Array(McpDiagnosticProjectionSchema, { maxItems: 128 }),
      },
      { additionalProperties: false },
    ),
    addons: Type.Array(AddonDiagnosticProjectionSchema, { maxItems: 32 }),
    subsystems: Type.Object(
      {
        fileIndex: Type.Object(
          {
            state: Type.Union([
              Type.Literal('ready'),
              Type.Literal('cold'),
              Type.Literal('degraded'),
              Type.Literal('unsupported'),
            ]),
            loadErrorCode: Type.Union([DiagnosticMachineCodeSchema, Type.Null()]),
          },
          { additionalProperties: false },
        ),
        memory: Type.Object(
          {
            dbExists: Type.Boolean(),
            fallbackInMemory: Type.Boolean(),
            unitCount: Type.Integer({ minimum: 0 }),
            problemCount: Type.Integer({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
        automations: Type.Object(
          {
            totalCount: Type.Integer({ minimum: 0 }),
            enabledCount: Type.Integer({ minimum: 0 }),
            storeProblem: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
        computer: Type.Object(
          {
            hostConnected: Type.Boolean(),
            busy: Type.Boolean(),
            bindingCount: Type.Integer({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
        wpsSelection: Type.Object(
          {
            connected: Type.Boolean(),
            hasError: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    recentRuns: Type.Array(RecentRunDiagnosticProjectionSchema, { maxItems: 20 }),
    runPrepDecisionRing: Type.Object(
      {
        capacity: Type.Integer({ minimum: 1, maximum: 32 }),
        droppedCount: Type.Integer({ minimum: 0 }),
        entries: Type.Array(RunPrepDecisionEntrySchema, { maxItems: 32 }),
      },
      { additionalProperties: false },
    ),
    boundedLogRing: BoundedLogRingSchema,
  },
  { additionalProperties: false },
);
export type ServiceDiagnosticsSnapshot = Static<typeof ServiceDiagnosticsSnapshotSchema>;
