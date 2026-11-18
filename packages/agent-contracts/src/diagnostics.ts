import { Type, type Static } from 'typebox';

/**
 * Diagnostic layer identifier for the 7-layer static Doctor matrix:
 * app placement and signing, macOS permissions and keychain, service and storage,
 * shell profile and CLI toolchain, proxy/TLS and clock, native add-ons and index,
 * and opt-in external connectivity.
 */
export const DoctorLayerSchema = Type.Union([
  Type.Literal('install_and_bundle'),
  Type.Literal('permissions_and_keychain'),
  Type.Literal('service_and_storage'),
  Type.Literal('shell_and_toolchain'),
  Type.Literal('network_proxy_and_clock'),
  Type.Literal('native_addons_and_index'),
  Type.Literal('on_demand_connectivity'),
]);
export type DoctorLayer = Static<typeof DoctorLayerSchema>;

/** Outcome status of a single static Doctor check. */
export const DoctorStatusSchema = Type.Union([
  Type.Literal('pass'),
  Type.Literal('warn'),
  Type.Literal('fail'),
  Type.Literal('skipped'),
]);
export type DoctorStatus = Static<typeof DoctorStatusSchema>;

/**
 * Deterministic host or settings navigation actions paired with a fine-grained
 * localized `remediationCode` (`remediation.<code>` in `diagnostics.json`).
 */
export const DoctorRemediationActionSchema = Type.Union([
  Type.Literal('open_system_settings_accessibility'),
  Type.Literal('open_system_settings_screen_recording'),
  Type.Literal('open_system_settings_input_monitoring'),
  Type.Literal('open_system_settings_login_items'),
  Type.Literal('move_to_applications'),
  Type.Literal('restart_service'),
  Type.Literal('relaunch_app'),
  Type.Literal('open_settings_section'),
  Type.Literal('run_live_probe'),
  Type.Literal('open_external_docs'),
  Type.Literal('none'),
]);
export type DoctorRemediationAction = Static<typeof DoctorRemediationActionSchema>;

/** Auto-disarming 10-second interactive live probe categories (`diagnostics.liveProbe.*`). */
export const LiveProbeKindSchema = Type.Union([
  Type.Literal('selection'),
  Type.Literal('hotkey'),
  Type.Literal('capture'),
]);
export type LiveProbeKind = Static<typeof LiveProbeKindSchema>;

/** Stable machine-readable identifier for check ids, reason codes, and remediation codes. */
export const DiagnosticMachineCodeSchema = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: '^[a-z][a-z0-9_.-]{0,95}$',
});
export type DiagnosticMachineCode = Static<typeof DiagnosticMachineCodeSchema>;

/** Bounded ASCII identifier for pre-sanitized check metric keys. */
export const DoctorMetricKeySchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$',
});
export type DoctorMetricKey = Static<typeof DoctorMetricKeySchema>;

/**
 * Pre-sanitized scalar metric value: short version/category strings, durations, counts, or flags.
 * Raw `PATH`, `process.env`, personal usernames, and credential fragments are never emitted here.
 */
export const DoctorMetricValueSchema = Type.Union([
  Type.String({ maxLength: 256 }),
  Type.Number(),
  Type.Boolean(),
]);
export type DoctorMetricValue = Static<typeof DoctorMetricValueSchema>;

export const DoctorRemediationSchema = Type.Object(
  {
    /** Stable localization key suffix (`remediation.<code>` in `diagnostics.json`). */
    remediationCode: DiagnosticMachineCodeSchema,
    action: DoctorRemediationActionSchema,
    /** Target settings section id (for example `'providers'`) when `action === 'open_settings_section'`. */
    settingsSection: Type.Optional(
      Type.String({ minLength: 1, maxLength: 32, pattern: '^[a-z][a-z0-9-]{0,31}$' }),
    ),
    /** Suggested 10-second live probe when `action === 'run_live_probe'`. */
    probeKind: Type.Optional(LiveProbeKindSchema),
    /** Public HTTPS documentation URL when `action === 'open_external_docs'`. */
    docsUrl: Type.Optional(Type.String({ minLength: 8, maxLength: 512, pattern: '^https://' })),
  },
  { additionalProperties: false },
);
export type DoctorRemediation = Static<typeof DoctorRemediationSchema>;

/**
 * Result of one static Doctor check. Shared semantically between the Node service (`<= 2,200 ms`)
 * and the Swift shell (`<= 1,500 ms`), running in parallel within a `<= 2,500 ms` wall budget.
 */
export const DoctorCheckResultSchema = Type.Object(
  {
    id: DiagnosticMachineCodeSchema,
    layer: DoctorLayerSchema,
    status: DoctorStatusSchema,
    reasonCode: DiagnosticMachineCodeSchema,
    durationMs: Type.Number({ minimum: 0, maximum: 60_000 }),
    metrics: Type.Record(DoctorMetricKeySchema, DoctorMetricValueSchema, {
      maxProperties: 32,
      additionalProperties: false,
    }),
    remediation: Type.Optional(DoctorRemediationSchema),
  },
  { additionalProperties: false },
);
export type DoctorCheckResult = Static<typeof DoctorCheckResultSchema>;

/** Request body for `POST /v1/diagnostics/run` (`RENDERER_ROUTE`). */
export const DoctorRunRequestSchema = Type.Object(
  {
    /**
     * Defaults to `false` (strictly local checks with zero external network traffic). When `true`,
     * runs opt-in `HEAD https://downloads.atd.best` TLS/clock-skew and provider reachability checks.
     */
    includeConnectivity: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type DoctorRunRequest = Static<typeof DoctorRunRequestSchema>;

/** Pre-sanitized response body for `POST /v1/diagnostics/run` (`RENDERER_ROUTE`). */
export const DoctorRunResponseSchema = Type.Object(
  {
    ranAt: Type.String({ maxLength: 64 }),
    serviceEpoch: Type.Integer({ minimum: 0 }),
    durationMs: Type.Number({ minimum: 0, maximum: 120_000 }),
    includeConnectivity: Type.Boolean(),
    checks: Type.Array(DoctorCheckResultSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type DoctorRunResponse = Static<typeof DoctorRunResponseSchema>;

/**
 * Passive state of `security:launch-approval-key`: distinguishes clean profiles (`not_created`)
 * from broken keychain ACLs (`unreadable`) or corrupt bytes (`malformed`) without modal prompts.
 */
export const LaunchApprovalKeyStateSchema = Type.Union([
  Type.Literal('not_created'),
  Type.Literal('readable'),
  Type.Literal('unreadable'),
  Type.Literal('malformed'),
]);
export type LaunchApprovalKeyState = Static<typeof LaunchApprovalKeyStateSchema>;

/** Dual-cap in-memory service log ring bounds: at most 500 lines and `512 KiB` (`524_288` UTF-8 bytes). */
export const SERVICE_LOG_RING_MAX_BYTES = 524_288;
export const SERVICE_LOG_RING_MAX_LINES = 500;
export const SERVICE_LOG_LINE_MAX_BYTES = 4096;

export const BoundedLogRingSchema = Type.Object(
  {
    maxBytes: Type.Literal(SERVICE_LOG_RING_MAX_BYTES),
    totalCapturedEntries: Type.Integer({ minimum: 0 }),
    droppedEntries: Type.Integer({ minimum: 0 }),
    byteLength: Type.Integer({ minimum: 0, maximum: SERVICE_LOG_RING_MAX_BYTES }),
    lines: Type.Array(Type.String({ maxLength: SERVICE_LOG_LINE_MAX_BYTES }), {
      maxItems: SERVICE_LOG_RING_MAX_LINES,
    }),
  },
  { additionalProperties: false },
);
export type BoundedLogRing = Static<typeof BoundedLogRingSchema>;
