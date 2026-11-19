import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import {
  parse,
  ServiceConnectionsFileSchema,
  type ProviderBaseUrlShape,
  type ProviderDiagnosticProjection,
  type RecentRunDiagnosticProjection,
  type ServiceConnection,
  type ServiceDiagnosticsSnapshot,
} from '@atd/agent-contracts';
import { isRestrictedComputerRun } from '../computer/tool-set.js';
import type { Ledger } from '../ledger.js';
import { catalogDefaultBaseUrl } from '../providers/catalog.js';
import { currentCredentialIssues } from '../providers/credential-issues.js';
import { readMcpPassiveSummary, type McpPassiveSummary } from './doctor-mcp-summary.js';
import { extractNestedErrorCode, isTlsCertCode } from './doctor-probes.js';
import { sanitizeMachineCode } from './run-prep-ring.js';

export { readMcpPassiveSummary, type McpPassiveSummary };

export const SNAPSHOT_MAX_BYTES = 600 * 1024;
const LOCAL_NET_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'EACCES']);
const errorCategoriesByDataDir = new Map<string, Map<string, string>>();

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

function normalizeComparableUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

function parseBaseUrlShape(baseUrl: string, provider: string): ProviderBaseUrlShape {
  const trimmed = baseUrl.trim();
  if (!trimmed) return { customHost: false, scheme: null, loopback: false };
  try {
    const parsed = new URL(trimmed);
    const scheme =
      parsed.protocol === 'http:' ? 'http' : parsed.protocol === 'https:' ? 'https' : 'invalid';
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const norm = normalizeComparableUrl(trimmed);
    const defaultNorm = normalizeComparableUrl(catalogDefaultBaseUrl(provider));
    return {
      customHost: norm === null || defaultNorm === null || norm !== defaultNorm,
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
      conn.authType === 'oauth' || conn.authType === 'api_key' || conn.authType === 'ambient'
        ? conn.authType
        : 'none';
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
      baseUrlShape: parseBaseUrlShape(conn.baseUrl, conn.provider),
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
            mcpStrippedForUnattended:
              isRestrictedComputerRun(run.snapshot) ||
              matching.some(
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
  let totalBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  if (totalBytes <= SNAPSHOT_MAX_BYTES) return snapshot;

  while (totalBytes > SNAPSHOT_MAX_BYTES) {
    const needToFree = totalBytes - SNAPSHOT_MAX_BYTES + 16;
    let freed = 0;

    const lines = snapshot.boundedLogRing.lines;
    let dropLines = 0;
    let rawFreed = 0;
    while (dropLines < lines.length && freed < needToFree) {
      const line = lines[dropLines]!;
      freed +=
        Buffer.byteLength(JSON.stringify(line), 'utf8') + (dropLines < lines.length - 1 ? 1 : 0);
      rawFreed += Buffer.byteLength(line, 'utf8');
      dropLines += 1;
    }
    if (dropLines > 0) {
      lines.splice(0, dropLines);
      snapshot.boundedLogRing.byteLength = Math.max(
        0,
        snapshot.boundedLogRing.byteLength - rawFreed,
      );
      snapshot.boundedLogRing.droppedEntries += dropLines;
    }

    while (snapshot.recentRuns.length > 0 && freed < needToFree) {
      const comma = snapshot.recentRuns.length > 1 ? 1 : 0;
      const item = snapshot.recentRuns.pop()!;
      freed += Buffer.byteLength(JSON.stringify(item), 'utf8') + comma;
    }

    const ringEntries = snapshot.runPrepDecisionRing.entries;
    let dropRing = 0;
    while (dropRing < ringEntries.length && freed < needToFree) {
      const comma = dropRing < ringEntries.length - 1 ? 1 : 0;
      freed += Buffer.byteLength(JSON.stringify(ringEntries[dropRing]!), 'utf8') + comma;
      dropRing += 1;
    }
    if (dropRing > 0) {
      ringEntries.splice(0, dropRing);
      snapshot.runPrepDecisionRing.droppedCount += dropRing;
    }

    if (freed === 0) break;
    totalBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  }
  return snapshot;
}
