import { readFile } from 'node:fs/promises';
import type { McpDiagnosticProjection, McpServerConfig } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { envReferences } from '../mcp/env-references.js';
import { probeLaunchApprovalKeyState, type LaunchApprovalKeyState } from '../mcp/launch-key.js';
import { launchStoreFile } from '../mcp/launch-store.js';
import { getActiveMcpConnectionStates } from '../mcp/lifecycle.js';
import { loadPluginServerLayer } from '../mcp/plugin-servers.js';
import { readStoredServers, type StoredServer } from '../mcp/server-file.js';
import { sanitizeMachineCode } from './run-prep-ring.js';

const LAUNCHER_NAMES = new Set(['npx', 'uv', 'uvx', 'git']);

export interface McpPassiveSummary {
  launchApprovalKeyState: LaunchApprovalKeyState;
  servers: McpDiagnosticProjection[];
  degradedCount: number;
  requiredLaunchers: string[];
}

/**
 * Computes whether an MCP server requires launch approval passively without hydrating
 * `{ keyring: true }` secret references or touching OS Keychain. Matches `launchKind` semantics:
 * stdio always requires approval; HTTP requires approval iff bearer `tokenEnv` is set or `url` /
 * any string header value contains `${ENV}` / `$env:NAME` / `{env:NAME}` references.
 */
export function requiresLaunchApprovalPassive(srv: StoredServer | McpServerConfig): boolean {
  if (srv.transport === 'stdio' || srv.stdio !== null) return true;
  if (!srv.http) return false;
  if (srv.http.auth.type === 'bearer' && srv.http.auth.tokenEnv.trim().length > 0) return true;
  if (envReferences(srv.http.url).length > 0) return true;
  for (const val of Object.values(srv.http.headers)) {
    if (typeof val === 'string' && envReferences(val).length > 0) return true;
  }
  return false;
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
    if (state === 'error' || state === 'auth_required' || state === 'approval_required') {
      degradedCount += 1;
    }
    const rawErr = liveStates?.lastError(srv.serverId) ?? '';
    const lastErrorCode = rawErr
      ? (sanitizeMachineCode(rawErr.split(/\W+/, 1)[0]) ?? 'mcp_error')
      : null;
    if (!srv.disabled && srv.stdio?.command) {
      const cmd = srv.stdio.command.trim();
      if (!cmd.includes('/') && !cmd.includes('\\')) {
        const base = cmd.toLowerCase();
        if (LAUNCHER_NAMES.has(base)) launchers.add(base);
      }
    }
    const needsApproval = requiresLaunchApprovalPassive(srv);
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
