import path from 'node:path';
import type { DoctorCheckResult, DoctorMetricValue, ServiceConnection } from '@atd/agent-contracts';
import { getAddonLockDiagnostics } from '../addons/lock.js';
import type { AddonRegistry } from '../addons/registry.js';
import type { KeyringStatus } from '../credentials/keyring.js';
import type { Logger } from '../logging.js';
import { getMemoryIndexDiagnostics } from '../memory/index-db.js';
import { currentCredentialIssues } from '../providers/credential-issues.js';
import type { ServicePaths } from '../storage.js';
import { getWpsSelectionDiagnostics } from '../wps-selection/bridge.js';
import {
  actRem,
  defaultProviderEndpointProbe,
  probeKeyringPassive,
  timedCheck,
} from './doctor-probes.js';
import {
  classifyProviderFailure,
  getProviderErrorCategory,
  readConnectionsPassive,
  recordProviderErrorCategory,
  resetProviderErrorCategoriesForTests,
  type McpPassiveSummary,
} from './doctor-projections.js';

const ENDPOINT_PROBE_TIMEOUT_MS = 1_500;

export {
  getProviderErrorCategory,
  recordProviderErrorCategory,
  resetProviderErrorCategoriesForTests,
};

export interface ProviderDoctorInput {
  serviceId: string;
  paths: ServicePaths;
  addons: AddonRegistry;
  log: Logger;
  includeConnectivity: boolean;
  mcpSummary: Promise<McpPassiveSummary> | McpPassiveSummary;
  signal?: AbortSignal | undefined;
}

export interface ProviderDoctorHooks {
  probeKeyring?: (() => Promise<KeyringStatus>) | undefined;
  probeProviderEndpoint?:
    | ((
        conn: ServiceConnection,
        signal: AbortSignal,
      ) => Promise<{ ok: boolean; status?: number; error?: unknown }>)
    | undefined;
}

export function runProviderDoctorChecks(
  input: ProviderDoctorInput,
  hooks: ProviderDoctorHooks = {},
): Array<Promise<DoctorCheckResult>> {
  const keychainCheck = timedCheck(
    'perm.keychain_and_launch_key',
    'permissions_and_keychain',
    async () => {
      const [keyring, connections, mcpSummary] = await Promise.all([
        probeKeyringPassive(input.serviceId, hooks.probeKeyring),
        readConnectionsPassive(input.paths.root),
        Promise.resolve(input.mcpSummary),
      ]);
      const issues = currentCredentialIssues(input.paths.root, connections);
      const issueCount = issues ? Object.keys(issues).length : 0;
      const keyState = mcpSummary.launchApprovalKeyState;
      const metrics: Record<string, DoctorMetricValue> = {
        keyringAvailable: keyring.available,
        keyringBackend: keyring.backend,
        launchApprovalKeyState: keyState,
        providerCredentialIssueCount: issueCount,
      };
      const extRem = actRem(
        'reapprove_mcp_or_reconnect_provider',
        'open_settings_section',
        'extensions',
      );
      const provRem = actRem(
        'reapprove_mcp_or_reconnect_provider',
        'open_settings_section',
        'providers',
      );
      if (!keyring.available)
        return { status: 'fail', reasonCode: 'keyring_unavailable', metrics, remediation: provRem };
      if (keyState === 'unreadable')
        return {
          status: 'fail',
          reasonCode: 'launch_approval_key_unreadable',
          metrics,
          remediation: extRem,
        };
      if (keyState === 'malformed')
        return {
          status: 'fail',
          reasonCode: 'launch_approval_key_malformed',
          metrics,
          remediation: extRem,
        };
      if (issueCount > 0)
        return {
          status: 'warn',
          reasonCode: 'provider_credential_unreadable',
          metrics,
          remediation: provRem,
        };
      return { status: 'pass', reasonCode: 'ok', metrics };
    },
  );

  const memoryCheck = timedCheck(
    'native.memory_index_health',
    'native_addons_and_index',
    async () => {
      const diag = getMemoryIndexDiagnostics(path.join(input.paths.agentDir, 'memory', 'index.db'));
      if (!diag) return { status: 'pass', reasonCode: 'ok', metrics: { initialized: false } };
      const metrics: Record<string, DoctorMetricValue> = {
        initialized: true,
        fallbackInMemory: diag.fallbackInMemory,
        ftsEnabled: diag.ftsEnabled,
        unitCount: diag.unitCount,
        rebuiltAtStartup: diag.rebuiltAtStartup,
      };
      const rem = actRem('inspect_memory_index_fallback', 'none');
      if (diag.fallbackInMemory)
        return {
          status: 'warn',
          reasonCode: 'sqlite_in_memory_fallback',
          metrics,
          remediation: rem,
        };
      if (!diag.ftsEnabled)
        return {
          status: 'warn',
          reasonCode: 'fts5_trigram_unavailable',
          metrics,
          remediation: rem,
        };
      return { status: 'pass', reasonCode: 'ok', metrics };
    },
  );

  const addonsCheck = timedCheck('native.optional_addons', 'native_addons_and_index', async () => {
    const lock = getAddonLockDiagnostics();
    const views = input.addons.list();
    const installedCount = views.filter((v) => v.installed !== undefined).length;
    const integrity = views.some((v) => v.error?.code === 'integrity');
    const broken = views.some((v) => v.outdated !== undefined || v.error !== undefined);
    const metrics: Record<string, DoctorMetricValue> = {
      lockStatus: lock.status,
      artifactCount: lock.artifactCount,
      installedCount,
    };
    const rem = actRem('manage_browser_addon', 'open_settings_section', 'computer');
    if (lock.status !== 'ok')
      return {
        status: 'fail',
        reasonCode: 'addons_lock_missing_or_invalid',
        metrics,
        remediation: rem,
      };
    if (integrity)
      return { status: 'fail', reasonCode: 'addon_integrity_mismatch', metrics, remediation: rem };
    if (broken)
      return {
        status: 'warn',
        reasonCode: 'addon_broken_install_dropped',
        metrics,
        remediation: rem,
      };
    return {
      status: 'pass',
      reasonCode: installedCount === 0 ? 'not_installed_optional' : 'ok',
      metrics,
    };
  });

  const bridgesCheck = timedCheck(
    'native.mcp_and_wps_bridges',
    'native_addons_and_index',
    async () => {
      const mcpSummary = await Promise.resolve(input.mcpSummary);
      const wps = getWpsSelectionDiagnostics(input.paths.root);
      const metrics: Record<string, DoctorMetricValue> = {
        mcpServerCount: mcpSummary.servers.length,
        mcpDegradedCount: mcpSummary.degradedCount,
        wpsConnected: wps.connected,
        wpsHasError: wps.hasError,
      };
      const rem = actRem('open_mcp_extensions_settings', 'open_settings_section', 'extensions');
      if (mcpSummary.degradedCount > 0) {
        return {
          status: 'warn',
          reasonCode: 'mcp_connections_degraded',
          metrics,
          remediation: rem,
        };
      }
      if (wps.hasError)
        return { status: 'warn', reasonCode: 'wps_bridge_error', metrics, remediation: rem };
      return { status: 'pass', reasonCode: 'ok', metrics };
    },
  );

  const endpointsCheck = timedCheck(
    'conn.provider_endpoints',
    'on_demand_connectivity',
    async () => {
      if (!input.includeConnectivity) {
        return { status: 'skipped', reasonCode: 'not_requested', metrics: { requested: false } };
      }
      const conns = (await readConnectionsPassive(input.paths.root)).filter(
        (c) => c.connected && c.baseUrl,
      );
      const timeout = AbortSignal.timeout(ENDPOINT_PROBE_TIMEOUT_MS);
      const sig = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
      const probe = hooks.probeProviderEndpoint ?? defaultProviderEndpointProbe;
      const outcomes = await Promise.all(
        conns.map(async (c) => ({ conn: c, out: await probe(c, sig) })),
      );
      let firstReason:
        | 'provider_auth_failed'
        | 'local_network_permission_denied'
        | 'provider_tls_or_proxy_failed'
        | null = null;
      for (const { conn, out } of outcomes) {
        if (out.ok) {
          recordProviderErrorCategory(input.paths.root, conn.connectionId, null);
          continue;
        }
        const { reason, category } = classifyProviderFailure(out.status, out.error, conn.baseUrl);
        recordProviderErrorCategory(input.paths.root, conn.connectionId, category);
        firstReason ??= reason;
      }
      const metrics: Record<string, DoctorMetricValue> = {
        checkedCount: outcomes.length,
        failedCount: outcomes.filter((o) => !o.out.ok).length,
      };
      const rem = actRem('check_provider_or_local_network', 'open_settings_section', 'providers');
      return firstReason
        ? { status: 'fail', reasonCode: firstReason, metrics, remediation: rem }
        : { status: 'pass', reasonCode: 'ok', metrics };
    },
  );

  return [keychainCheck, memoryCheck, addonsCheck, bridgesCheck, endpointsCheck];
}
