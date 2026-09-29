import { mkdir } from 'node:fs/promises';
import { BrowserWindow, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { parse } from '../../src/client/agent/validation';
import { createConfirm } from '../confirm-dialog';
import { autostartService } from './autostart';
import { resolveServiceDataDir } from './data-dir';
import { ServiceConnection, type ServiceStatus } from './connection';
import { startLocalService } from './launcher';
import { serviceLogDir } from './service-log';
import { ServiceSupervisor } from './supervisor';
import { ServiceRequestSchema, type ServiceStatusView } from '../../src/client/service/ipc';
import { SERVICE_IPC } from './ipc-channels';
import { handleExtensionRequest } from '../../src/client/service/extension-requests';
import { McpApprovalGate } from './mcp-approval';

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
  private readonly supervisor: ServiceSupervisor;
  private readonly approvals: McpApprovalGate;
  constructor(
    private readonly send: (channel: string, value: unknown) => void,
    private readonly assertSender: (event: IpcMainInvokeEvent) => void,
    private readonly caps: {
      panelVisible: () => boolean;
      withDialog: <T>(op: () => Promise<T>) => Promise<T>;
      /** Whether a native dialog or window operation is in progress (`withDialog` would refuse). */
      dialogBusy: () => boolean;
    },
    /** Runs after the connection changed: on `false` its options are already gone. */
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
    this.supervisor = new ServiceSupervisor(this.connection, {
      dataDir: () => this.defaultDataDir(),
      onLive: this.onLive,
    });
    this.approvals = new McpApprovalGate({
      options: () => this.connection.options(),
      dialogBusy: caps.dialogBusy,
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
      supervisor: this.supervisor,
    });
  }

  /**
   * Menu action: replaces the default dataDir's service and resumes supervision with a clean
   * crash history, including after the breaker gave up. Never rejects; a failure is shown on the
   * connection.
   */
  async restart(): Promise<void> {
    await this.supervisor.restart();
  }

  /** Menu action: opens the folder with service.log and its rotated predecessors. */
  async revealLogs(): Promise<void> {
    const dir = serviceLogDir(this.defaultDataDir());
    // The folder only exists after a first spawn; an adopted service may predate it.
    await mkdir(dir, { recursive: true });
    const failure = await shell.openPath(dir);
    if (failure) throw new Error(failure);
  }

  /**
   * Drops the client connection, then stops supervision and the local service. Disconnecting
   * first keeps the service's own close of the stream from reading as a drop to reconnect from,
   * and keeps `onLive(false)` listeners from sending requests to a service that is stopping.
   */
  async shutdown(): Promise<void> {
    this.connection.disconnect('The agent service is stopping.');
    this.onLive(false);
    await this.supervisor.stop();
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
        // Manual connection changes take over from supervision, so a later exit of the
        // supervised service no longer respawns it.
        case 'connect':
          this.supervisor.release();
          await this.connection.connect(request.dataDir);
          this.onLive(true);
          return this.statusView();
        case 'disconnect': {
          this.supervisor.release();
          const status = this.connection.disconnect();
          this.onLive(false);
          return view(status, this.defaultDataDir());
        }
        case 'startLocal': {
          this.supervisor.release();
          await startLocalService({ dataDir: request.dataDir, port: request.port });
          await this.connection.connect(request.dataDir);
          this.onLive(true);
          return this.statusView();
        }
        default:
          return handleExtensionRequest(this.connection.options(), request, {
            openExternal: (url) => shell.openExternal(url),
            // A sheet on the window that asked; only the validated server id comes from it.
            requestMcpApproval: (serverId) =>
              this.approvals.request(
                serverId,
                createConfirm(
                  () => BrowserWindow.fromWebContents(event.sender),
                  this.caps.withDialog,
                ),
              ),
          });
      }
    });
  }
}
