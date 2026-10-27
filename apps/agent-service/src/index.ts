import { DEFAULT_PERMISSION_TIER, errorMessage, type PermissionTier } from '@atd/agent-contracts';
import { AddonRegistry } from './addons/index.js';
import { AutomationService } from './automations/service.js';
import { CapabilityRegistry } from './capabilities.js';
import { launchCommand } from './commands/launch.js';
import { automationComputer } from './automations/computer-deps.js';
import { createComputerGrantCheck } from './computer/grants-live.js';
import { ComputerRuntime } from './computer/runtime.js';
import { syncStarterCommands } from './commands/starters.js';
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
import { invalidateOffRoute } from './invalidate.js';
import { Ledger } from './ledger.js';
import { createLogger, type Logger } from './logging.js';
import { McpAuthority, migrateMcpSecrets } from './mcp/index.js';
import { createMemoryConsolidator } from './memory/consolidation/index.js';
import { createSystemProxy, type SystemProxy } from './network/system-proxy.js';
import { PluginHost } from './plugins/host.js';
import { recoverService, type RecoveryReport } from './recovery.js';
import { ResourceStore } from './resources.js';
import { RunnerManager } from './runner-manager.js';
import { buildServer, type ServerDeps } from './server.js';
import { effectiveLanguage } from './settings/language.js';
import { SettingsStore } from './settings/store.js';
import { SystemActivity } from './system-activity.js';
import type { RunnerContext } from './task-runner.js';
import { NextStepJobs } from './tasks/next-steps.js';
import { TaskTitles } from './tasks/titles.js';
import type { SyncProfile } from './development/plan.js';

export type { ServiceConfig } from './config.js';
export type { RecoveryReport } from './recovery.js';
export { Ledger } from './ledger.js';
export { EventLog } from './event-log.js';
export { ConfirmStore } from './confirms.js';
export { CapabilityRegistry } from './capabilities.js';
export { RunnerManager } from './runner-manager.js';
export { TaskRunner } from './task-runner.js';
export { ComputerRuntime } from './computer/runtime.js';

export interface ServiceHandle {
  config: ServiceConfig;
  ledger: Ledger;
  events: EventLog;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  resources: ResourceStore;
  computer: ComputerRuntime;
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
    /** A host may establish networking before spawning helpers; the service adopts its lifetime. */
    systemProxy?: SystemProxy;
    /** The CLI's `--tier` flag, passed through when given. */
    tier?: PermissionTier | undefined;
    /** Explicit development CLI capability; packaged app launchers leave it off. */
    development?: SyncProfile | undefined;
    /**
     * Answers `POST /v1/admin/shutdown` once the reply is out. Only the process
     * host may exit, so the CLI passes the stop-then-exit handler its signals
     * use; without one the route only stops the service.
     */
    onShutdownRequest?: () => void;
  } = {},
): Promise<ServiceHandle> {
  const log = createLogger(process.env.AI_AGENT_LOG_LEVEL === 'debug' ? 'debug' : 'info');
  const systemProxy = options.systemProxy ?? (await createSystemProxy(log));
  const startedAt = new Date().toISOString();
  const ledger = await Ledger.load(config.paths);
  const events = new EventLog(config.serviceId, config.epoch);
  const confirms = new ConfirmStore(ledger, events, log);
  const capabilities = new CapabilityRegistry(ledger, events, log);
  const resources = new ResourceStore(ledger, config.paths);
  // Grants and trials are checked by the automations module; until it injects its check through
  // `computer.setGrantCheck`, every recipe-bound computer action is refused (grant-check.ts).
  // Optional components the user downloads (design: add-ons); computer use runs on two of them.
  const addons = await AddonRegistry.create({
    dataDir: config.paths.root,
    development: options.development !== undefined,
    log,
  });
  const computer = await ComputerRuntime.create({
    dataDir: config.paths.root,
    log,
    addons,
    development: options.development !== undefined,
  });
  // Reads settings, answers and automation names once runs complete, after all three exist.
  const nextSteps = new NextStepJobs({
    ledger,
    events,
    paths: config.paths,
    log,
    enabled: () => settings.current().settings.nextSteps,
    blocks: async (taskId) => (await manager.snapshot(taskId)).blocks,
    automations: () => automations.store.data.definitions.automations.map(({ name }) => name),
    notify: (taskId) => invalidateOffRoute(app, { type: 'invalidate', scope: 'task', taskId }),
  });
  const runnerContext: RunnerContext = {
    ledger,
    events,
    confirms,
    capabilities,
    computer,
    paths: config.paths,
    log,
    tier: options.tier ?? DEFAULT_PERMISSION_TIER,
    nextSteps,
  };
  const settings = await SettingsStore.load(config.paths.root, runnerContext.tier);
  const titles = new TaskTitles({
    ledger,
    paths: config.paths,
    log,
    enabled: () => settings.current().settings.summaryTitles,
    notify: (taskId) => invalidateOffRoute(app, { type: 'invalidate', scope: 'task', taskId }),
  });
  const folders = await FolderStore.load(config.paths.root);
  const manager = new RunnerManager({
    ctx: runnerContext,
    resources,
    folders,
    log,
    newTaskTier: () => settings.newTaskTier(),
    titles,
  });
  const report = await recoverService({ ledger, events, confirms, capabilities, log });
  // Before anything reads the MCP servers, so the first MCP use finds their values in the keyring.
  await migrateMcpSecrets(config.paths.root, config.serviceId, log).catch((error: unknown) =>
    log.warn('MCP values were not moved into the OS keyring; the next start retries.', {
      error: errorMessage(error),
    }),
  );
  await syncStarterCommands(
    config.paths.root,
    await effectiveLanguage(settings.current().settings.language),
  ).catch((error: unknown) =>
    log.warn('The starter commands were not added or updated; the next start retries.', {
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
    consolidateMemory: createMemoryConsolidator({ paths: config.paths, log }),
    activity: new SystemActivity(),
    language: () => settings.current().settings.language,
    log,
    computer: automationComputer(computer),
  });
  computer.setGrantCheck(createComputerGrantCheck(automations.store, computer.bindings));

  let stopping: (() => Promise<void>) | null = null;
  const serverDeps: ServerDeps = {
    systemProxy,
    config,
    development: options.development,
    ledger,
    events,
    confirms,
    capabilities,
    resources,
    computer,
    addons,
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
    // Running add-on installs stop before anything else writes under the dataDir for the last time.
    await addons.stop();
    // The host stops every computer action first; the runs then drain with the manager.
    await computer.stopAll('shuttingDown');
    await manager.shutdown();
    await app.close();
    await McpAuthority.closeFor(config.paths.root);
    await PluginHost.closeFor(config.paths.root);
    await systemProxy.close();
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
    computer,
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
      // Outdated add-ons are replaced in the background once the routes that show it answer.
      addons.start();
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
