import type { PermissionTier } from '@ai/agent-contracts';
import { CapabilityRegistry } from './capabilities.js';
import { clearEndpoint, releaseLock, writeEndpoint, type ServiceConfig } from './config.js';
import { ConfirmStore } from './confirms.js';
import { EventLog } from './event-log.js';
import { Ledger } from './ledger.js';
import { createLogger, type Logger } from './logging.js';
import { recoverService, type RecoveryReport } from './recovery.js';
import { ResourceStore } from './resources.js';
import { RunnerManager } from './runner-manager.js';
import { buildServer } from './server.js';
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
  log: Logger;
  startedAt: string;
  report: RecoveryReport;
  start: () => Promise<{ url: string; port: number }>;
  stop: () => Promise<void>;
}

/**
 * Importable service entry. Wires ledger, events, confirms, capabilities,
 * resources, runners and transport; `start` listens and publishes the
 * endpoint, `stop` drains and releases the dataDir lock.
 */
export async function createService(
  config: ServiceConfig,
  options: { tier?: PermissionTier } = {},
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
  const manager = new RunnerManager({ ctx: runnerContext, resources, log });
  const report = await recoverService({ ledger, events, confirms, capabilities, log });

  let stopping: (() => Promise<void>) | null = null;
  const app = await buildServer({
    config,
    ledger,
    events,
    confirms,
    capabilities,
    resources,
    manager,
    log,
    startedAt,
    onShutdown: () => {
      if (stopping)
        void stopping().catch((error: unknown) =>
          log.error('Shutdown failed.', { error: String(error) }),
        );
    },
  });

  const handle: ServiceHandle = {
    config,
    ledger,
    events,
    confirms,
    capabilities,
    resources,
    manager,
    log,
    startedAt,
    report,
    start: async () => {
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
      });
      manager.dispatch();
      return { url: address, port };
    },
    stop: async () => {
      await manager.shutdown();
      await app.close();
      await clearEndpoint(config.paths);
      await releaseLock(config.paths);
    },
  };
  stopping = handle.stop;
  return handle;
}
