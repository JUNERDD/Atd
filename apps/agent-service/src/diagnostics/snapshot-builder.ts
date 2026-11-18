import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  parse,
  PROTOCOL_VERSION,
  ServiceDiagnosticsSnapshotSchema,
  type ServiceDiagnosticsSnapshot,
} from '@atd/agent-contracts';
import type { AddonRegistry } from '../addons/registry.js';
import type { AutomationService } from '../automations/service.js';
import type { CapabilityRegistry } from '../capabilities.js';
import type { ComputerRuntime } from '../computer/runtime.js';
import type { ServiceConfig } from '../config.js';
import type { ConfirmStore } from '../confirms.js';
import { getFileIndexDiagnostics } from '../file-routes.js';
import type { Ledger } from '../ledger.js';
import { getServiceLogRing, type Logger } from '../logging.js';
import { getLoginShellPathDiagnostics } from '../login-shell-path.js';
import { getMemoryIndexDiagnostics } from '../memory/index-db.js';
import type { SystemProxy } from '../network/system-proxy.js';
import type { RunnerManager } from '../runner-manager.js';
import { getWpsSelectionDiagnostics } from '../wps-selection/bridge.js';
import { isNodeUseSystemCaEnabled, readPathSummary } from './doctor-probes.js';
import {
  enforceSnapshotSizeCap,
  projectProviders,
  projectRecentRuns,
  readConnectionsPassive,
  readMcpPassiveSummary,
  SNAPSHOT_MAX_BYTES,
} from './doctor-projections.js';
import { getRunPrepDecisionRing, sanitizeMachineCode } from './run-prep-ring.js';

export { SNAPSHOT_MAX_BYTES };

export interface SnapshotBuilderDeps {
  config: ServiceConfig;
  systemProxy: SystemProxy;
  ledger: Ledger;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  computer: ComputerRuntime;
  addons: AddonRegistry;
  manager: RunnerManager;
  automations: AutomationService;
  log: Logger;
  startedAt: string;
}

/**
 * Builds an allowlisted `ServiceDiagnosticsSnapshot` for `SHELL_ROUTE` (`GET /v1/admin/diagnostics/snapshot`),
 * strictly excluding raw ledger inputs, audit logs, session transcripts, memory DBs, and auth tokens.
 */
export async function buildServiceDiagnosticsSnapshot(
  deps: SnapshotBuilderDeps,
): Promise<ServiceDiagnosticsSnapshot> {
  const dataDir = deps.config.paths.root;
  const memoryDbPath = path.join(deps.config.paths.agentDir, 'memory', 'index.db');
  const [connections, mcpSummary, memoryDbExists] = await Promise.all([
    readConnectionsPassive(dataDir),
    readMcpPassiveSummary(deps.config.serviceId, dataDir, deps.log),
    access(memoryDbPath, constants.F_OK).then(
      () => true,
      () => false,
    ),
  ]);

  const loginShell = getLoginShellPathDiagnostics();
  const pathSummary = readPathSummary();
  const proxyStatus = deps.systemProxy.diagnosticsStatus();
  const fileIndex = getFileIndexDiagnostics(dataDir);
  const memoryDiag = getMemoryIndexDiagnostics(memoryDbPath);
  const hostStatus = deps.computer.coordinator.hostStatus();
  const prepRing = getRunPrepDecisionRing().snapshot();

  const snapshot: ServiceDiagnosticsSnapshot = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    service: {
      serviceId: deps.config.serviceId,
      protocolVersion: PROTOCOL_VERSION,
      epoch: deps.config.epoch,
      startedAt: deps.startedAt,
      nodeVersion: process.version.slice(0, 32),
      arch: process.arch.slice(0, 16),
      platform: process.platform.slice(0, 16),
      pid: process.pid,
      uptimeMs: Math.max(0, Math.round(Date.now() - Date.parse(deps.startedAt))),
      draining: deps.manager.isDraining(),
      activeRuns: deps.manager.activeRunCount(),
      pendingConfirms: deps.confirms.pending().length,
      pendingCapabilities: deps.capabilities.pending().length,
    },
    environmentSummary: {
      loginShellResolved: loginShell.resolved,
      loginShellDurationMs: loginShell.durationMs,
      loginShellFallbackReason: loginShell.fallbackReason,
      pathEntryCount: pathSummary.entryCount,
      hasHomebrewPath: pathSummary.hasHomebrewPath,
      hasUsrLocalPath: pathSummary.hasUsrLocalPath,
      systemProxyMode: proxyStatus.mode,
      skippedProxyBypassCount: proxyStatus.skippedBypassCount,
      hasNodeExtraCaCerts: Boolean(process.env.NODE_EXTRA_CA_CERTS?.trim()),
      nodeUseSystemCa: isNodeUseSystemCaEnabled(),
    },
    providers: projectProviders(dataDir, connections),
    mcp: {
      launchApprovalKeyState: mcpSummary.launchApprovalKeyState,
      servers: mcpSummary.servers,
    },
    addons: deps.addons
      .list()
      .slice(0, 32)
      .map((view) => ({
        id: view.id.slice(0, 64),
        available: view.available,
        phase: view.phase.slice(0, 32),
        installedVersion: view.installed?.version.slice(0, 64) ?? null,
        outdatedVersion: view.outdated?.version.slice(0, 64) ?? null,
        errorCode: view.error?.code ?? null,
      })),
    subsystems: {
      fileIndex: {
        state: fileIndex.state,
        loadErrorCode: sanitizeMachineCode(fileIndex.loadErrorCode),
      },
      memory: {
        dbExists: memoryDbExists,
        fallbackInMemory: memoryDiag?.fallbackInMemory ?? false,
        unitCount: memoryDiag?.unitCount ?? 0,
        problemCount: memoryDiag?.lastErrorCode ? 1 : 0,
      },
      automations: {
        totalCount: deps.automations.store.data.definitions.automations.length,
        enabledCount: deps.automations.store.data.definitions.automations.filter((a) => a.enabled)
          .length,
        storeProblem: Boolean(deps.automations.store.problem),
      },
      computer: {
        hostConnected: hostStatus.state === 'ready',
        busy: hostStatus.state === 'locked' || deps.computer.coordinator.inFlight(),
        bindingCount: deps.computer.bindings.list().length,
      },
      wpsSelection: getWpsSelectionDiagnostics(dataDir),
    },
    recentRuns: projectRecentRuns(deps.ledger, prepRing.entries),
    runPrepDecisionRing: prepRing,
    boundedLogRing: getServiceLogRing().snapshot(),
  };

  return parse(ServiceDiagnosticsSnapshotSchema, enforceSnapshotSizeCap(snapshot));
}
