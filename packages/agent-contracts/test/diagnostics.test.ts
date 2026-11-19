import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BoundedLogRingSchema,
  DoctorCheckResultSchema,
  DoctorLayerSchema,
  DoctorRemediationActionSchema,
  DoctorRemediationSchema,
  DoctorRunRequestSchema,
  DoctorRunResponseSchema,
  DoctorStatusSchema,
  ErrorCodeSchema,
  ErrorEnvelopeSchema,
  LaunchApprovalKeyStateSchema,
  LiveProbeKindSchema,
  McpDiagnosticProjectionSchema,
  ProviderDiagnosticProjectionSchema,
  SERVICE_LOG_LINE_MAX_BYTES,
  SERVICE_LOG_RING_MAX_BYTES,
  SERVICE_LOG_RING_MAX_LINES,
  ServiceDiagnosticsSnapshotSchema,
  ServiceUnavailableCodeSchema,
  parse,
} from '@atd/agent-contracts';

function assertClosedAndBounded(node: unknown, path = '$'): void {
  if (!node || typeof node !== 'object') return;
  const schema = node as Record<string, unknown>;
  if (schema.type === 'object') {
    assert.equal(
      schema.additionalProperties,
      false,
      `${path} must set additionalProperties: false`,
    );
    if (schema.patternProperties && typeof schema.patternProperties === 'object') {
      assert.equal(typeof schema.maxProperties, 'number', `${path} record must set maxProperties`);
      for (const [pattern, child] of Object.entries(schema.patternProperties)) {
        assertClosedAndBounded(child, `${path}.pattern[${pattern}]`);
      }
    }
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, child] of Object.entries(schema.properties)) {
        assertClosedAndBounded(child, `${path}.${key}`);
      }
    }
  } else if (schema.type === 'string' && !('const' in schema)) {
    assert.equal(typeof schema.maxLength, 'number', `${path} string must set maxLength`);
  } else if (schema.type === 'array') {
    assert.equal(typeof schema.maxItems, 'number', `${path} array must set maxItems`);
    assertClosedAndBounded(schema.items, `${path}[]`);
  }
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((branch, index) => assertClosedAndBounded(branch, `${path}|${index}`));
  }
}

test('ErrorCodeSchema accepts structured service unavailability codes and rejects unknown codes', () => {
  const unavailableCodes = [
    'service_starting',
    'service_start_failed',
    'service_stopped_too_often',
    'service_not_running',
  ] as const;
  for (const code of unavailableCodes) {
    assert.equal(parse(ServiceUnavailableCodeSchema, code), code);
    assert.equal(parse(ErrorCodeSchema, code), code);
    const envelope = parse(ErrorEnvelopeSchema, {
      error: { code, message: 'Service unavailable.' },
    });
    assert.equal(envelope.error.code, code);
  }
  assert.throws(() => parse(ErrorCodeSchema, 'service_crashed_unknown'), TypeError);
  assert.throws(
    () =>
      parse(ErrorEnvelopeSchema, {
        error: { code: 'service_starting', message: 'starting', extra: true },
      }),
    TypeError,
  );
});

test('Doctor enums, request, check result, and response enforce bounds and closed objects', () => {
  for (const layer of [
    'install_and_bundle',
    'permissions_and_keychain',
    'service_and_storage',
    'shell_and_toolchain',
    'network_proxy_and_clock',
    'native_addons_and_index',
    'on_demand_connectivity',
  ]) {
    assert.equal(parse(DoctorLayerSchema, layer), layer);
  }
  for (const status of ['pass', 'warn', 'fail', 'skipped']) {
    assert.equal(parse(DoctorStatusSchema, status), status);
  }
  for (const kind of ['selection', 'hotkey', 'capture']) {
    assert.equal(parse(LiveProbeKindSchema, kind), kind);
  }
  assert.equal(
    parse(DoctorRemediationActionSchema, 'open_settings_section'),
    'open_settings_section',
  );
  assert.throws(() => parse(DoctorRemediationActionSchema, 'run_arbitrary_shell'), TypeError);

  assert.deepEqual(parse(DoctorRunRequestSchema, {}), {});
  assert.deepEqual(parse(DoctorRunRequestSchema, { includeConnectivity: true }), {
    includeConnectivity: true,
  });
  assert.throws(
    () => parse(DoctorRunRequestSchema, { includeConnectivity: false, extra: 1 }),
    TypeError,
  );

  const validCheck = {
    id: 'shell.login_path_resolution',
    layer: 'shell_and_toolchain',
    status: 'warn',
    reasonCode: 'login_shell_timed_out_5s',
    durationMs: 120,
    metrics: { pathEntryCount: 8, hasHomebrew: true, shellKind: 'zsh' },
    remediation: {
      remediationCode: 'optimize_shell_rc_profile',
      action: 'open_external_docs',
      docsUrl: 'https://atd.best/docs/troubleshooting',
    },
  };
  assert.equal(parse(DoctorCheckResultSchema, validCheck).id, 'shell.login_path_resolution');

  // Reject HTTP or script docs URLs, uppercase machine codes, invalid metric keys, >32 metrics.
  assert.throws(
    () =>
      parse(DoctorRemediationSchema, {
        remediationCode: 'fix_it',
        action: 'open_external_docs',
        docsUrl: 'http://atd.best/insecure',
      }),
    TypeError,
  );
  assert.throws(
    () => parse(DoctorCheckResultSchema, { ...validCheck, id: 'InvalidUpper' }),
    TypeError,
  );
  assert.throws(
    () => parse(DoctorCheckResultSchema, { ...validCheck, metrics: { '9badKey': 1 } }),
    TypeError,
  );
  assert.throws(
    () =>
      parse(DoctorCheckResultSchema, {
        ...validCheck,
        metrics: { rawEnv: 'x'.repeat(257) },
      }),
    TypeError,
  );
  const tooManyMetrics = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]));
  assert.throws(
    () => parse(DoctorCheckResultSchema, { ...validCheck, metrics: tooManyMetrics }),
    TypeError,
  );

  const response = {
    ranAt: '2026-11-18T08:30:00.000Z',
    serviceEpoch: 3,
    durationMs: 412,
    includeConnectivity: false,
    checks: [validCheck],
  };
  assert.equal(parse(DoctorRunResponseSchema, response).checks.length, 1);
  assert.throws(
    () =>
      parse(DoctorRunResponseSchema, {
        ...response,
        checks: Array.from({ length: 65 }, () => validCheck),
      }),
    TypeError,
  );
});

test('ServiceDiagnosticsSnapshotSchema enforces allowlist projections and ring caps', () => {
  for (const state of ['not_created', 'readable', 'unreadable', 'malformed']) {
    assert.equal(parse(LaunchApprovalKeyStateSchema, state), state);
  }
  const snapshot = {
    schemaVersion: 1,
    capturedAt: '2026-11-18T08:30:00.000Z',
    service: {
      serviceId: 'svc_01',
      protocolVersion: '1',
      epoch: 2,
      startedAt: '2026-11-18T08:00:00.000Z',
      nodeVersion: 'v24.19.0',
      arch: 'arm64',
      platform: 'darwin',
      pid: 4242,
      uptimeMs: 18_000,
      draining: false,
      activeRuns: 0,
      pendingConfirms: 0,
      pendingCapabilities: 0,
    },
    environmentSummary: {
      loginShellResolved: true,
      loginShellDurationMs: 45,
      loginShellFallbackReason: null,
      pathEntryCount: 12,
      hasHomebrewPath: true,
      hasUsrLocalPath: true,
      systemProxyMode: 'direct',
      skippedProxyBypassCount: 0,
      hasNodeExtraCaCerts: false,
      nodeUseSystemCa: true,
    },
    providers: [
      {
        connectionIdHash: 'a1b2c3d4',
        provider: 'openai',
        authType: 'api_key',
        connected: true,
        hasCredential: true,
        credentialIssue: null,
        baseUrlShape: { customHost: false, scheme: 'https', loopback: false },
        modelCheckStatus: 'ok',
        lastErrorCategory: null,
      },
    ],
    mcp: {
      launchApprovalKeyState: 'not_created',
      servers: [
        {
          serverId: 'filesystem',
          transport: 'stdio',
          state: 'connected',
          approval: 'approved',
          envKeyCount: 2,
          headerKeyCount: 0,
          lastErrorCode: null,
        },
      ],
    },
    addons: [
      {
        id: 'computer-browser',
        available: true,
        phase: 'idle',
        installedVersion: '1.0.0',
        outdatedVersion: null,
        errorCode: null,
      },
    ],
    subsystems: {
      fileIndex: { state: 'ready', loadErrorCode: null },
      memory: { dbExists: true, fallbackInMemory: false, unitCount: 14, problemCount: 0 },
      automations: { totalCount: 2, enabledCount: 1, storeProblem: false },
      computer: { hostConnected: true, busy: false, bindingCount: 0 },
      wpsSelection: { connected: false, hasError: false },
    },
    recentRuns: [
      {
        runIdPrefix: 'run_1234',
        createdAt: '2026-11-18T08:15:00.000Z',
        status: 'failed',
        triggerKind: 'manual',
        errorCategory: 'auth_required',
        degradedFlags: {
          pluginsDegraded: false,
          memoryDegraded: false,
          catalogError: false,
          mcpStrippedForUnattended: false,
        },
      },
    ],
    runPrepDecisionRing: {
      capacity: 32,
      droppedCount: 0,
      entries: [
        {
          seq: 1,
          ts: '2026-11-18T08:15:00.000Z',
          runIdPrefix: 'run_1234',
          phase: 'memory_freeze',
          durationMs: 4,
          outcome: 'completed',
          reasonCode: null,
        },
      ],
    },
    boundedLogRing: {
      maxBytes: SERVICE_LOG_RING_MAX_BYTES,
      totalCapturedEntries: 1,
      droppedEntries: 0,
      byteLength: 42,
      lines: ['{"level":"info","msg":"started"}'],
    },
  };
  assert.equal(parse(ServiceDiagnosticsSnapshotSchema, snapshot).schemaVersion, 1);
  for (const authType of ['api_key', 'oauth', 'none', 'ambient'] as const) {
    assert.equal(
      parse(ProviderDiagnosticProjectionSchema, { ...snapshot.providers[0], authType }).authType,
      authType,
    );
  }
  assert.throws(
    () =>
      parse(ProviderDiagnosticProjectionSchema, {
        ...snapshot.providers[0],
        connectionIdHash: 'NOTHEX8!',
      }),
    TypeError,
  );
  assert.throws(
    () =>
      parse(McpDiagnosticProjectionSchema, {
        ...snapshot.mcp.servers[0],
        envValues: { SECRET: 'leak' },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      parse(BoundedLogRingSchema, {
        ...snapshot.boundedLogRing,
        byteLength: SERVICE_LOG_RING_MAX_BYTES + 1,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      parse(BoundedLogRingSchema, {
        ...snapshot.boundedLogRing,
        lines: ['x'.repeat(SERVICE_LOG_LINE_MAX_BYTES + 1)],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      parse(BoundedLogRingSchema, {
        ...snapshot.boundedLogRing,
        lines: Array.from({ length: SERVICE_LOG_RING_MAX_LINES + 1 }, () => '{}'),
      }),
    TypeError,
  );
});

test('Every diagnostics schema node is closed and explicitly bounded', () => {
  assertClosedAndBounded(DoctorRunRequestSchema, 'DoctorRunRequest');
  assertClosedAndBounded(DoctorRunResponseSchema, 'DoctorRunResponse');
  assertClosedAndBounded(ServiceDiagnosticsSnapshotSchema, 'ServiceDiagnosticsSnapshot');
});
