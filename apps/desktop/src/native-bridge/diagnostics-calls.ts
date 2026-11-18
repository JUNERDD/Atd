/**
 * Native bridge diagnostics calls and events (`calls.ts`, `contract.ts`). Loaded by the schema
 * export script with Node's type stripping, so it imports only TypeBox and `./primitives.ts` and
 * uses only erasable TypeScript syntax.
 */
import { Type, type TSchema } from 'typebox';
import { Empty, Text } from './primitives.ts';

const MachineCode = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: '^[a-z][a-z0-9_.-]{0,95}$',
});

export const ShellDoctorLayerSchema = Type.Union([
  Type.Literal('install_and_bundle'),
  Type.Literal('permissions_and_keychain'),
  Type.Literal('service_and_storage'),
  Type.Literal('shell_and_toolchain'),
  Type.Literal('network_proxy_and_clock'),
  Type.Literal('native_addons_and_index'),
  Type.Literal('on_demand_connectivity'),
]);

export const ShellDoctorStatusSchema = Type.Union([
  Type.Literal('pass'),
  Type.Literal('warn'),
  Type.Literal('fail'),
  Type.Literal('skipped'),
]);

export const ShellRemediationActionSchema = Type.Union([
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

export const NativeLiveProbeKindSchema = Type.Union([
  Type.Literal('selection'),
  Type.Literal('hotkey'),
  Type.Literal('capture'),
]);

export const ShellServiceFailureCodeSchema = Type.Union([
  Type.Literal('service_starting'),
  Type.Literal('service_start_failed'),
  Type.Literal('service_stopped_too_often'),
  Type.Literal('service_not_running'),
]);

export const ShellMetricItemSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$' }),
    value: Text(256),
  },
  { additionalProperties: false },
);

export const ShellCheckRemediationSchema = Type.Object(
  {
    remediationCode: MachineCode,
    action: ShellRemediationActionSchema,
    settingsSection: Type.Optional(
      Type.String({ minLength: 1, maxLength: 32, pattern: '^[a-z][a-z0-9-]{0,31}$' }),
    ),
    probeKind: Type.Optional(NativeLiveProbeKindSchema),
    docsUrl: Type.Optional(Type.String({ maxLength: 512, pattern: '^https://' })),
  },
  { additionalProperties: false },
);

export const ShellDoctorCheckSchema = Type.Object(
  {
    id: MachineCode,
    layer: ShellDoctorLayerSchema,
    status: ShellDoctorStatusSchema,
    reasonCode: MachineCode,
    durationMs: Type.Number({ minimum: 0, maximum: 60000 }),
    metrics: Type.Array(ShellMetricItemSchema, { maxItems: 32 }),
    remediation: Type.Optional(ShellCheckRemediationSchema),
  },
  { additionalProperties: false },
);

export const DecisionRingSummarySchema = Type.Object(
  {
    ringId: Type.Union([
      Type.Literal('selection'),
      Type.Literal('hotkeys'),
      Type.Literal('capture_arbiter'),
      Type.Literal('relay_supervisor'),
    ]),
    capacity: Type.Integer({ minimum: 1, maximum: 1024 }),
    entryCount: Type.Integer({ minimum: 0, maximum: 1024 }),
    droppedCount: Type.Integer({ minimum: 0 }),
    lastEventAt: Type.Union([Text(64), Type.Null()]),
    recentAnomalyCount: Type.Integer({ minimum: 0 }),
    heldResources: Type.Array(Text(64), { maxItems: 16 }),
  },
  { additionalProperties: false },
);

/**
 * One in-memory renderer breadcrumb. Holds only normalized error codes, short summaries, and
 * stream/bridge transitions; never React state, query data, mutation variables, or draft inputs.
 */
export const RendererBreadcrumbItemSchema = Type.Object(
  {
    seq: Type.Integer({ minimum: 1 }),
    ts: Text(64),
    category: Type.Union([
      Type.Literal('error_boundary'),
      Type.Literal('unhandled_error'),
      Type.Literal('unhandled_rejection'),
      Type.Literal('query_error'),
      Type.Literal('mutation_error'),
      Type.Literal('stream_state'),
      Type.Literal('bridge_drop'),
    ]),
    windowRole: Type.Union([
      Type.Literal('panel'),
      Type.Literal('settings'),
      Type.Literal('onboarding'),
      Type.Literal('view'),
    ]),
    code: Type.Union([Text(64), Type.Null()]),
    name: Type.Union([Text(64), Type.Null()]),
    /** Capped at 320 code units so 128 items stay within the `<= 128 KiB` bridge payload cap. */
    message: Text(320),
  },
  { additionalProperties: false },
);

export const RendererBreadcrumbsPayloadSchema = Type.Object(
  {
    capturedAt: Text(64),
    droppedCount: Type.Integer({ minimum: 0 }),
    entries: Type.Array(RendererBreadcrumbItemSchema, { maxItems: 128 }),
  },
  { additionalProperties: false },
);

export const BundleFileStatusSchema = Type.Union([
  Type.Literal('included'),
  Type.Literal('omitted_redaction_error'),
  Type.Literal('omitted_not_opted_in'),
  Type.Literal('omitted_unavailable'),
  Type.Literal('omitted_size_cap'),
]);

export const BundlePreviewFileSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 256 }),
    status: BundleFileStatusSchema,
    byteSize: Type.Integer({ minimum: 0, maximum: 8388608 }),
    redactionHits: Type.Integer({ minimum: 0 }),
    /** Post-scrubber preview excerpt; cumulative across all files stays `<= 128 KiB`. */
    previewExcerpt: Type.Union([Text(16384), Type.Null()]),
    excerptTruncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

const LiveProbeEndedReasonSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('timeout'),
  Type.Literal('stopped'),
  Type.Literal('window_closed'),
]);

export const NativeDiagnosticsCalls = {
  /** Runs Swift shell checks and returns live summaries of the 4 native decision rings. */
  'diagnostics.shellReport': {
    params: Empty,
    result: Type.Object(
      {
        capturedAt: Text(64),
        appVersion: Text(64),
        buildNumber: Text(64),
        isDevelopment: Type.Boolean(),
        serviceState: Type.Union([
          Type.Literal('idle'),
          Type.Literal('starting'),
          Type.Literal('running'),
          Type.Literal('restarting'),
          Type.Literal('unavailable'),
        ]),
        serviceFailureCode: Type.Union([ShellServiceFailureCodeSchema, Type.Null()]),
        serviceFailureSummary: Type.Union([Text(240), Type.Null()]),
        checks: Type.Array(ShellDoctorCheckSchema, { maxItems: 48 }),
        rings: Type.Array(DecisionRingSummarySchema, { maxItems: 8 }),
      },
      { additionalProperties: false },
    ),
  },
  /** Arms a 10-second live probe; auto-disarms on timeout, window close, or `stop`. */
  'diagnostics.liveProbe.start': {
    params: Type.Object({ kind: NativeLiveProbeKindSchema }, { additionalProperties: false }),
    result: Type.Object(
      {
        probeId: Type.String({ minLength: 1, maxLength: 64 }),
        kind: NativeLiveProbeKindSchema,
        durationMs: Type.Integer({ minimum: 1000, maximum: 10000 }),
      },
      { additionalProperties: false },
    ),
  },
  /** Disarms any active live probe; idempotent when none is running. */
  'diagnostics.liveProbe.stop': {
    params: Empty,
    result: Empty,
  },
  /** Builds and scrubs the support bundle in memory (`<= 128 KiB` excerpts, zero disk writes). */
  'diagnostics.previewBundle': {
    params: Type.Object(
      {
        rendererBreadcrumbs: RendererBreadcrumbsPayloadSchema,
        includeCrashSummaries: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    result: Type.Object(
      {
        generatedAt: Text(64),
        suggestedFileName: Type.String({ minLength: 1, maxLength: 128 }),
        totalUncompressedBytes: Type.Integer({ minimum: 0, maximum: 8388608 }),
        totalRedactionHits: Type.Integer({ minimum: 0 }),
        omittedFileCount: Type.Integer({ minimum: 0 }),
        files: Type.Array(BundlePreviewFileSchema, { maxItems: 32 }),
      },
      { additionalProperties: false },
    ),
  },
  /** Exports the scrubbed `.zip` via `NSSavePanel` without returning the chosen filesystem path. */
  'diagnostics.exportBundle': {
    params: Type.Object(
      {
        rendererBreadcrumbs: RendererBreadcrumbsPayloadSchema,
        includeCrashSummaries: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    result: Type.Union([
      Type.Object(
        {
          outcome: Type.Literal('saved'),
          fileName: Type.String({ minLength: 1, maxLength: 255 }),
          archiveBytes: Type.Integer({ minimum: 1 }),
          omittedFileCount: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      Type.Object({ outcome: Type.Literal('cancelled') }, { additionalProperties: false }),
    ]),
  },
  /** Triggers supervised service restart from `ServiceBanner` or `DiagnosticsSettings`. */
  'diagnostics.restartService': {
    params: Empty,
    result: Type.Union([
      Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
      Type.Object(
        {
          ok: Type.Literal(false),
          reasonCode: MachineCode,
          summary: Text(240),
        },
        { additionalProperties: false },
      ),
    ]),
  },
} satisfies Record<string, { params: TSchema; result: TSchema }>;

/** Swift → JS live-probe stream; never carries selected text, keystrokes, or screen pixels. */
export const NativeDiagnosticsEvents = {
  'diagnostics.liveProbe.event': Type.Union([
    Type.Object(
      {
        kind: Type.Literal('selection'),
        probeId: Type.String({ minLength: 1, maxLength: 64 }),
        ts: Text(64),
        remainingMs: Type.Integer({ minimum: 0, maximum: 10000 }),
        endedReason: LiveProbeEndedReasonSchema,
        axTrusted: Type.Boolean(),
        frontmostBundleId: Type.Union([Text(255), Type.Null()]),
        excludedByAppRule: Type.Boolean(),
        axRole: Type.Union([Text(64), Type.Null()]),
        selectedLength: Type.Integer({ minimum: 0 }),
        gateOutcome: MachineCode,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal('hotkey'),
        probeId: Type.String({ minLength: 1, maxLength: 64 }),
        ts: Text(64),
        remainingMs: Type.Integer({ minimum: 0, maximum: 10000 }),
        endedReason: LiveProbeEndedReasonSchema,
        secureInputEnabled: Type.Boolean(),
        postEventTrusted: Type.Boolean(),
        globalMonitorActive: Type.Boolean(),
        matchedShortcutId: Type.Union([Text(128), Type.Null()]),
        modifierFlagsMask: Type.Integer({ minimum: 0 }),
        handoffOutcome: MachineCode,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal('capture'),
        probeId: Type.String({ minLength: 1, maxLength: 64 }),
        ts: Text(64),
        remainingMs: Type.Integer({ minimum: 0, maximum: 10000 }),
        endedReason: LiveProbeEndedReasonSchema,
        screenRecordingTrusted: Type.Boolean(),
        displayCount: Type.Integer({ minimum: 0, maximum: 16 }),
        sdrFreezeReady: Type.Boolean(),
        arbiterInteractiveHeld: Type.Boolean(),
        heldOwnerSummary: Type.Union([Text(128), Type.Null()]),
        gateOutcome: MachineCode,
      },
      { additionalProperties: false },
    ),
  ]),
} satisfies Record<string, TSchema>;
