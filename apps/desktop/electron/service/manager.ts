import { ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { parse } from '../agent/validation';
import { autostartService } from './autostart';
import { resolveServiceDataDir } from './data-dir';
import { ServiceConnection, type ServiceStatus } from './connection';
import { startLocalService, stopLocalService } from './launcher';
import { ServiceRequestSchema, type ServiceStatusView } from './ipc';
import { SERVICE_IPC } from './ipc-channels';
import { createWebPairing } from '@ai/agent-client';
import { handleExtensionRequest } from './extension-requests';

function view(status: ServiceStatus, fallbackDataDir: string): ServiceStatusView {
  return {
    state: status.state,
    detail: status.detail,
    serviceId: status.endpoint?.serviceId ?? status.service?.service.serviceId ?? null,
    epoch: status.endpoint?.epoch ?? status.service?.service.epoch ?? null,
    draining: status.service?.draining ?? false,
    activeRuns: status.service?.activeRuns ?? 0,
    pendingConfirms: status.service?.pendingConfirms ?? 0,
    pendingCapabilities: status.service?.pendingCapabilities ?? 0,
    dataDir: status.endpoint?.dataDir ?? fallbackDataDir,
    baseUrl: status.endpoint?.baseUrl ?? null,
    stream: status.stream,
  };
}

/**
 * Main-side service manager. Owns the ServiceConnection (bearer token stays
 * in main) and mirrors status/skills/roles/MCP over the narrow service IPC.
 * No task execution here; tasks live in the rewritten AgentService client.
 */
export class ServiceManager {
  readonly connection: ServiceConnection;
  constructor(
    private readonly send: (channel: string, value: unknown) => void,
    private readonly assertSender: (event: IpcMainInvokeEvent) => void,
    caps: { panelVisible: () => boolean; withDialog: <T>(op: () => Promise<T>) => Promise<T> },
    private readonly onLive: (connected: boolean) => void = () => undefined,
  ) {
    this.connection = new ServiceConnection(
      {
        onStatus: (status) =>
          this.send(SERVICE_IPC.changed, {
            type: 'status',
            status: view(status, this.defaultDataDir()),
          }),
        onSnapshot: () => undefined,
        onSummaries: () => undefined,
        onEvent: () => undefined,
      },
      caps,
    );
    this.connection.onInvalidate((frame) => {
      if (frame.scope === 'extensions') this.send(SERVICE_IPC.changed, { type: 'extensions' });
    });
  }

  defaultDataDir(): string {
    return resolveServiceDataDir();
  }

  /**
   * Starts in parallel with the first window; the connection stays connecting
   * until the service is live, so the renderer never flashes disconnected.
   */
  async autostart(): Promise<void> {
    await autostartService(this.connection, {
      dataDir: this.defaultDataDir(),
      onLive: this.onLive,
    });
  }

  /** Stops the local service, then drops the client connection. */
  async shutdown(): Promise<void> {
    try {
      await stopLocalService(this.defaultDataDir());
    } finally {
      this.onLive(false);
      this.connection.disconnect();
    }
  }

  /**
   * Opens the web client of the connected service in the default browser. The link carries a
   * one-time pairing code, so the browser gets its own session and never sees the owner token.
   * Under `pnpm dev` it opens the dev server, which serves the live client and proxies `/v1`.
   */
  async openInBrowser(): Promise<void> {
    const options = this.connection.options();
    if (!options) throw new Error('The service is not connected.');
    const { code } = await createWebPairing(options);
    const origin = new URL(process.env.VITE_DEV_SERVER_URL || options.baseUrl).origin;
    await shell.openExternal(`${origin}/#pair=${code}`);
  }

  statusView(): ServiceStatusView {
    return view(this.connection.status(), this.defaultDataDir());
  }

  installIpc() {
    ipcMain.handle(SERVICE_IPC.request, async (event, value: unknown) => {
      this.assertSender(event);
      const request = parse(ServiceRequestSchema, value);
      switch (request.action) {
        case 'status':
          return this.statusView();
        case 'connect':
          await this.connection.connect(request.dataDir);
          this.onLive(true);
          return this.statusView();
        case 'disconnect':
          this.onLive(false);
          return view(this.connection.disconnect(), this.defaultDataDir());
        case 'openInBrowser':
          await this.openInBrowser();
          return null;
        case 'startLocal': {
          await startLocalService({ dataDir: request.dataDir, port: request.port });
          await this.connection.connect(request.dataDir);
          this.onLive(true);
          return this.statusView();
        }
        default:
          return handleExtensionRequest(this.connection.options(), request, (url) =>
            shell.openExternal(url),
          );
      }
    });
  }
}
