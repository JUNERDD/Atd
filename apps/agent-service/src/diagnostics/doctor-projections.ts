import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import {
  parse,
  ServiceConnectionsFileSchema,
  type McpDiagnosticProjection,
  type ProviderBaseUrlShape,
  type ProviderDiagnosticProjection,
  type RecentRunDiagnosticProjection,
  type ServiceConnection,
  type ServiceDiagnosticsSnapshot,
} from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import { launchKind } from '../mcp/launch-fingerprint.js';
import { probeLaunchApprovalKeyState, type LaunchApprovalKeyState } from '../mcp/launch-key.js';
import { launchStoreFile } from '../mcp/launch-store.js';
import { getActiveMcpConnectionStates } from '../mcp/lifecycle.js';
import { loadPluginServerLayer } from '../mcp/plugin-servers.js';
import { readStoredServers } from '../mcp/server-file.js';
import { currentCredentialIssues } from '../providers/credential-issues.js';
import { extractNestedErrorCode, isTlsCertCode } from './doctor-probes.js';
import { sanitizeMachineCode } from './run-prep-ring.js';

export const SNAPSHOT_MAX_BYTES = 600 * 1024;
const LOCAL_NET_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'EACCES']);
const LAUNCHER_NAMES = new Set(['npx', 'uv', 'uvx', 'git']);
const errorCategoriesByDataDir = new Map<string, Map<string, string>>();

export interface McpPassiveSummary {
  launchApprovalKeyState: LaunchApprovalKeyState;
  servers: McpDiagnosticProjection[];
  degradedCount: number;
  requiredLaunchers: string[];
}

export function recordProviderErrorCategory(
  dataDir: string,
  connectionId: string,
  category: string | null,
): void {
  if (!category) {
    errorCategoriesByDataDir.get(dataDir)?.delete(connectionId);
    return;
  }
  const code = sanitizeMachineCode(category);
  if (!code) return;
  let map = errorCategoriesByDataDir.get(dataDir);
  if (!map) {
    map = new Map();
    errorCategoriesByDataDir.set(dataDir, map);
  }
  map.set(connectionId, code);
}

export function getProviderErrorCategory(dataDir: string, connectionId: string): string | null {
  return errorCategoriesByDataDir.get(dataDir)?.get(connectionId) ?? null;
}

export function resetProviderErrorCategoriesForTests(): void {
  errorCategoriesByDataDir.clear();
}

export function categorizeErrorText(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  if (/auth|unauthori[sz]ed|401|403/i.test(raw)) return 'auth_required';
  if (/credential|keychain|keyring/i.test(raw)) return 'credential_unreadable';
  if (/413|too large|context window/i.test(raw)) return 'upstream_413';
  if (/429|rate limit|quota/i.test(raw)) return 'rate_limited';
  if (/timeout|timed out|abort/i.test(raw)) return 'timeout';
  if (/tls|cert|ssl|self-signed/i.test(raw)) return 'tls_error';
  if (/network|enotfound|econnrefused|ehostunreach|enetunreach/i.test(raw)) return 'network_error';
  if (/cancel/i.test(raw)) return 'cancelled';
  if (/interrupt|restart/i.test(raw)) return 'interrupted';
  return 'run_error';
}

export function classifyProviderFailure(status?: number, error?: unknown, url?: string) {
  if (status === 401 || status === 403) {
    return { reason: 'provider_auth_failed' as const, category: 'unauthorized' };
  }
  const code = extractNestedErrorCode(error);
  if (code && LOCAL_NET_CODES.has(code)) {
    const host = (() => {
      try {
        return url ? new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase() : '';
      } catch {
        return '';
      }
    })();
    const isPrivateIp =
      isIP(host) !== 0 &&
      (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
        host === '::1' ||
        host.startsWith('fc') ||
        host.startsWith('fd') ||
        host.startsWith('fe80:'));
    if (host === 'localhost' || host.endsWith('.local') || isPrivateIp) {
      return {
        reason: 'local_network_permission_denied' as const,
        category: 'local_network_denied',
      };
    }
  }
  if (isTlsCertCode(code)) {
    return { reason: 'provider_tls_or_proxy_failed' as const, category: 'tls_untrusted_ca' };
  }
  return {
    reason: 'provider_tls_or_proxy_failed' as const,
    category: code ? code.toLowerCase() : 'proxy_connect_failed',
  };
}

export async function readConnectionsPassive(dataDir: string): Promise<ServiceConnection[]> {
  try {
    const raw = await readFile(path.join(dataDir, 'providers', 'connections.json'), 'utf8');
    return parse(ServiceConnectionsFileSchema, JSON.parse(raw)).connections;
  } catch {
    return [];
  }
}

export async function readMcpPassiveSummary(
  serviceId: string,
  dataDir: string,
  log: Logger,
): Promise<McpPassiveSummary> {
  let approvalIds = new Set<string>();
  try {
    const raw = JSON.parse(await readFile(launchStoreFile(dataDir), 'utf8')) as {
      approvals?: Array<{ serverId?: unknown }>;
    };
    if (Array.isArray(raw.approvals)) {
      approvalIds = new Set(
        raw.approvals.map((a) => a.serverId).filter((id): id is string => typeof id === 'string'),
      );
    }
  } catch {
    // Absent or unreadable.
  }
  const [storedServers, pluginLayer, keyState] = await Promise.all([
    readStoredServers(dataDir).catch(() => []),
    loadPluginServerLayer(dataDir, log),
    probeLaunchApprovalKeyState(serviceId, {
      hasSavedApprovals: approvalIds.size > 0,
      timeoutMs: 300,
    }),
  ]);
  const liveStates = getActiveMcpConnectionStates(dataDir);
  const all = [...storedServers, ...pluginLayer.records].slice(0, 128);
  const launchers = new Set<string>();
  let degradedCount = 0;

  const servers: McpDiagnosticProjection[] = all.map((srv) => {
    const state = liveStates
      ? liveStates.get(srv.serverId)
      : srv.disabled
        ? 'disabled'
        : 'disconnected';
    if (state === 'error' || state === 'auth_required' || state === 'approval_required')
      degradedCount += 1;
    const rawErr = liveStates?.lastError(srv.serverId) ?? '';
    const lastErrorCode = rawErr
      ? (sanitizeMachineCode(rawErr.split(/\W+/, 1)[0]) ?? 'mcp_error')
      : null;
    if (!srv.disabled && srv.stdio?.command) {
      const base = path.basename(srv.stdio.command.trim()).toLowerCase();
      if (LAUNCHER_NAMES.has(base)) launchers.add(base);
    }
    const needsApproval = launchKind(srv as Parameters<typeof launchKind>[0]) !== null;
    const approval = !needsApproval
      ? 'notRequired'
      : approvalIds.has(srv.serverId)
        ? 'approved'
        : 'required';
    return {
      serverId: srv.serverId,
      transport: srv.transport,
      state,
      approval,
      envKeyCount: Object.keys(srv.stdio?.env ?? {}).length,
      headerKeyCount: Object.keys(srv.http?.headers ?? {}).length,
      lastErrorCode,
    };
  });
  return {
    launchApprovalKeyState: keyState,
    servers,
    degradedCount,
    requiredLaunchers: [...launchers],
  };
}

function parseBaseUrlShape(baseUrl: string): ProviderBaseUrlShape {
  const trimmed = baseUrl.trim();
  if (!trimmed) return { customHost: false, scheme: null, loopback: false };
  try {
    const parsed = new URL(trimmed);
    const scheme =
      parsed.protocol === 'http:' ? 'http' : parsed.protocol === 'https:' ? 'https' : 'invalid';
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return {
      customHost: true,
      scheme,
      loopback: host === 'localhost' || host === '127.0.0.1' || host === '::1',
    };
  } catch {
    return { customHost: true, scheme: 'invalid', loopback: false };
  }
}

export function projectProviders(
  dataDir: string,
  connections: readonly ServiceConnection[],
): ProviderDiagnosticProjection[] {
  const issues = currentCredentialIssues(dataDir, connections);
  return connections.slice(0, 64).map((conn) => {
    const issue = issues?.[conn.connectionId];
    const credentialIssue =
      issue === 'unreadable'
        ? 'credential_unreadable'
        : issue === 'missing'
          ? 'credential_missing'
          : null;
    const authType =
      conn.authType === 'oauth' ? 'oauth' : conn.authType === 'api_key' ? 'api_key' : 'none';
    const lastErrorCategory =
      getProviderErrorCategory(dataDir, conn.connectionId) ??
      credentialIssue ??
      (conn.catalogError ? categorizeErrorText(conn.catalogError) : null);
    const modelCheckStatus =
      credentialIssue !== null || conn.catalogError
        ? 'failed'
        : conn.verifiedModel
          ? 'ok'
          : 'unverified';
    return {
      connectionIdHash: createHash('sha256').update(conn.connectionId).digest('hex').slice(0, 8),
      provider: conn.provider.slice(0, 128),
      authType,
      connected: conn.connected,
      hasCredential: conn.hasCredential,
      credentialIssue,
      baseUrlShape: parseBaseUrlShape(conn.baseUrl),
      modelCheckStatus,
      lastErrorCategory,
    };
  });
}

export function projectRecentRuns(
  ledger: Ledger,
  prepEntries: ReadonlyArray<{
    runIdPrefix: string;
    phase: string;
    outcome: string;
    reasonCode: string | null;
  }>,
): RecentRunDiagnosticProjection[] {
  const flat: Array<{ createdAt: string; proj: RecentRunDiagnosticProjection }> = [];
  for (const task of ledger.data.tasks) {
    for (const run of task.runs) {
      const runIdPrefix = run.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'unknown';
      const matching = prepEntries.filter(
        (e) => e.runIdPrefix === runIdPrefix && e.outcome === 'degraded',
      );
      const triggerKind = run.snapshot.trigger
        ? `${run.snapshot.trigger.kind}_${run.snapshot.trigger.source}`.slice(0, 32)
        : (task.origin?.kind ?? 'user').slice(0, 32);
      flat.push({
        createdAt: run.createdAt,
        proj: {
          runIdPrefix,
          createdAt: run.createdAt.slice(0, 64),
          status: run.status.slice(0, 32),
          triggerKind,
          errorCategory: categorizeErrorText(run.error),
          degradedFlags: {
            pluginsDegraded: matching.some(
              (e) => e.phase.includes('plugin') || (e.reasonCode?.includes('plugin') ?? false),
            ),
            memoryDegraded: matching.some(
              (e) => e.phase.includes('memory') || (e.reasonCode?.includes('memory') ?? false),
            ),
            catalogError: matching.some((e) => e.reasonCode?.includes('catalog') ?? false),
            mcpStrippedForUnattended: matching.some(
              (e) => e.phase.includes('mcp') || (e.reasonCode?.includes('mcp') ?? false),
            ),
          },
        },
      });
    }
  }
  flat.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return flat.slice(0, 20).map((item) => item.proj);
}

export function enforceSnapshotSizeCap(
  snapshot: ServiceDiagnosticsSnapshot,
): ServiceDiagnosticsSnapshot {
  while (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > SNAPSHOT_MAX_BYTES) {
    if (snapshot.boundedLogRing.lines.length > 0) {
      const droppedLine = snapshot.boundedLogRing.lines.shift()!;
      snapshot.boundedLogRing.byteLength = Math.max(
        0,
        snapshot.boundedLogRing.byteLength - Buffer.byteLength(droppedLine, 'utf8'),
      );
      snapshot.boundedLogRing.droppedEntries += 1;
      continue;
    }
    if (snapshot.recentRuns.length > 0) {
      snapshot.recentRuns.pop();
      continue;
    }
    if (snapshot.runPrepDecisionRing.entries.length > 0) {
      snapshot.runPrepDecisionRing.entries.shift();
      snapshot.runPrepDecisionRing.droppedCount += 1;
      continue;
    }
    break;
  }
  return snapshot;
}
