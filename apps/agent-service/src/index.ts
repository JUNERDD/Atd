import { errorMessage, type PermissionTier } from '@atd/agent-contracts';
import { AutomationService } from './automations/service.js';
import { CapabilityRegistry } from './capabilities.js';
import { launchCommand } from './commands/launch.js';
import { seedStarterCommands } from './commands/starters.js';
import {
  clearEndpoint,
  readBuildId,
  releaseLock,
  writeEndpoint,
  type ServiceConfig,
} from './config.js';
import { ConfirmStore } from './confirms.js';
import { EventLog } from './event-log.js';
import { FolderStore } from './folders/store.js';
import { Ledger } from './ledger.js';
import { createLogger, type Logger } from './logging.js';
import { McpAuthority, migrateMcpSecrets } from './mcp/index.js';
import { PluginHost } from './plugins/host.js';
import { recoverService, type RecoveryReport } from './recovery.js';
import { ResourceStore } from './resources.js';
import { RunnerManager } from './runner-manager.js';
import { buildServer, type ServerDeps } from './server.js';
import { SettingsStore } from './settings/store.js';
import type { RunnerContext } from './task-runner.js';

export type { ServiceConfig } from './config.js';
export type { RecoveryReport } from './recovery.js';
export { Ledger } from './ledger.js';
export { EventLog } from './event-log.js';
export { ConfirmStore } from './confirms.js';
export { CapabilityRegistry } from './capabilities.js';
export { RunnerManager } from './runner-manager.js';
export { TaskRunner } from './task-runner.js';

export interface ServiceHandle {
  config: ServiceConfig;
  ledger: Ledger;
  events: EventLog;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  resources: ResourceStore;
  manager: RunnerManager;
  automations: AutomationService;
  log: Logger;
  startedAt: string;
  report: RecoveryReport;
  start: () => Promise<{ url: string; port: number }>;
  stop: () => Promise<void>;
}

/**
 * Importable service entry. Wires ledger, events, confirms, capabilities,
 * resources, runners and transport; `start` listens and publishes the
 * endpoint, `stop` drains runs, closes HTTP and MCP, settles the plugin host,
 * and releases the dataDir lock. Every stop trigger shares one run of those steps.
 */
export async function createService(
  config: ServiceConfig,
  options: {
    /** The CLI's `--tier` flag, passed through when given. */
    tier?: PermissionTier | undefined;
    /**
     * Answers `POST /v1/admin/shutdown` once the reply is out. Only the process
     * host may exit, so the CLI passes the stop-then-exit handler its signals
     * use; without one the route only stops the service.
     */
    onShutdownRequest?: () => void;
  } = {},
): Promise<ServiceHandle> {
  const log = createLogger(process.env.AI_AGENT_LOG_LEVEL === 'debug' ? 'debug' : 'info');
  const startedAt = new Date().toISOString();
  const ledger = await Ledger.load(config.paths);
  const events = new EventLog(config.serviceId, config.epoch);
  const confirms = new ConfirmStore(ledger, events, log);
  const capabilities = new CapabilityRegistry(ledger, events, log);
  const resources = new ResourceStore(ledger, config.paths);
  const runnerContext: RunnerContext = {
    ledger,
    events,
    confirms,
    capabilities,
    paths: config.paths,
    log,
    tier: options.tier ?? 'manual',
  };
  const settings = await SettingsStore.load(config.paths.root, runnerContext.tier);
  const folders = await FolderStore.load(config.paths.root);
  const manager = new RunnerManager({
    ctx: runnerContext,
    resources,
    folders,
    log,
    newTaskTier: () => settings.newTaskTier(),
  });
  const report = await recoverService({ ledger, events, confirms, capabilities, log });
  // Before anything reads the MCP servers, so the first MCP use finds their values in the keyring.
  await migrateMcpSecrets(config.paths.root, config.serviceId, log).catch((error: unknown) =>
    log.warn('MCP values were not moved into the OS keyring; the next start retries.', {
      error: errorMessage(error),
    }),
  );
  await seedStarterCommands(config.paths.root).catch((error: unknown) =>
    log.warn('The starter commands were not added; the next start retries.', {
      error: errorMessage(error),
    }),
  );
  // After recovery and before any run dispatches: its reconciliation may cancel queued runs.
  const automations = await AutomationService.create({
    paths: config.paths,
    ledger,
    events,
    manager,
    launchCommand: (request, internal) =>
      launchCommand({ paths: config.paths, ledger, manager }, request, internal),
    folders,
    resources,
    log,
  });

  let stopping: (() => Promise<void>) | null = null;
  const serverDeps: ServerDeps = {
    config,
    ledger,
    events,
    confirms,
    capabilities,
    resources,
    manager,
    settings,
    folders,
    automations,
    log,
    startedAt,
    onShutdown:
      options.onShutdownRequest ??
      (() => {
        if (stopping)
          void stopping().catch((error: unknown) =>
            log.error('Shutdown failed.', { error: String(error) }),
          );
      }),
  };
  const app = await buildServer(serverDeps);
  // Runs drain and HTTP closes first, so MCP has lost its callers when the
  // close ends every MCP connection (base and per-task aliases) and its
  // stdio children. The plugin host settles after everything that reaches it,
  // so its creation (started with the service, unawaited) stops writing under
  // the dataDir; only then does the lock free the profile for a new service.
  // Clearing the endpoint tells the native supervisor the stop has finished
  // (`ServiceStopper`): it gives the process a short grace to exit, then kills it.
  const stopService = async () => {
    // No automation fires once draining begins; the runs it started stop with the manager.
    await automations.stop();
    await manager.shutdown();
    await app.close();
    await McpAuthority.closeFor(config.paths.root);
    await PluginHost.closeFor(config.paths.root);
    await clearEndpoint(config.paths);
    await releaseLock(config.paths);
  };
  // A signal that lands during an admin shutdown awaits the same run instead
  // of draining again and releasing the lock under it.
  let stopped: Promise<void> | null = null;

  const handle: ServiceHandle = {
    config,
    ledger,
    events,
    confirms,
    capabilities,
    resources,
    manager,
    automations,
    log,
    startedAt,
    report,
    start: async () => {
      // Read before listening: a broken build-info file fails startup before the port opens.
      const buildId = await readBuildId();
      const address = await app.listen({ host: config.host, port: config.port });
      const bound = app.server.address();
      const port = typeof bound === 'object' && bound ? bound.port : config.port;
      config.port = port;
      await writeEndpoint(config.paths, {
        serviceId: config.serviceId,
        protocolVersion: '1',
        epoch: config.epoch,
        host: config.host,
        port,
        url: address,
        pid: process.pid,
        startedAt,
        ...(buildId === undefined ? {} : { buildId }),
      });
      manager.dispatch();
      // After the recovered queue: their runs go first, then missed occurrences after a grace.
      automations.start();
      // The MCP authority is not loaded here: the desktop calls no MCP route on connect, and the
      // load reads the server records, launch approvals and saved sign-ins. The first MCP request
      // or run loads it, cached per dataDir (mcp/authority.ts).
      return { url: address, port };
    },
    stop: () => (stopped ??= stopService()),
  };
  stopping = handle.stop;
  return handle;
}
