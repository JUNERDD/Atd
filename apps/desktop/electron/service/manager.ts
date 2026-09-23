import { ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import {
  installSkill,
  listAtdAgents,
  listRoles,
  listSkills,
  putAtdAgent,
  putRole,
  setSkillEnabled,
  updateSkill,
} from '@ai/agent-client';
import { mcpAuthComplete, mcpAuthStart, mcpConnect, mcpStatus } from '@ai/agent-client';
import { parse } from '../agent/validation';
import { autostartService } from './autostart';
import { resolveServiceDataDir } from './endpoint';
import { ServiceConnection, type ServiceStatus } from './connection';
import { startLocalService, stopLocalService } from './launcher';
import { ServiceRequestSchema, type ServiceStatusView } from './ipc';
import { SERVICE_IPC } from './ipc-channels';
import { disableMcpServer, removeMcpServer, upsertMcpServer } from './mcp-catalog';

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
        onEvent: () => undefined,
      },
      caps,
    );
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
        case 'startLocal': {
          await startLocalService({ dataDir: request.dataDir, port: request.port });
          await this.connection.connect(request.dataDir);
          this.onLive(true);
          return this.statusView();
        }
        case 'skills': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return listSkills(options);
        }
        case 'skillsUpdate': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return updateSkill(options, request.name);
        }
        case 'skillsSetEnabled': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return setSkillEnabled(options, request.name, request.enabled);
        }
        case 'skillsInstall': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return installSkill(options, {
            source: request.source,
            sourceKind: request.sourceKind,
            ...(request.name !== undefined ? { name: request.name } : {}),
          });
        }
        case 'roles': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return listRoles(options);
        }
        case 'rolesPut': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return putRole(options, {
            id: request.id,
            title: request.title,
            allows: request.allows,
          });
        }
        case 'agents': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return listAtdAgents(options);
        }
        case 'agentsPut': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return putAtdAgent(options, {
            name: request.name,
            description: request.description,
            tools: request.tools,
            model: request.model,
            systemPrompt: request.systemPrompt,
          });
        }
        case 'mcpStatus': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return mcpStatus({ options });
        }
        case 'mcpConnect': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return mcpConnect({ options }, { serverId: request.serverId });
        }
        case 'mcpAuthStart': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          const result = await mcpAuthStart({ options }, { serverId: request.serverId });
          if (result.authorizationUrl) {
            const url = new URL(result.authorizationUrl);
            if (!['http:', 'https:'].includes(url.protocol))
              throw new Error('Only web links can be opened.');
            await shell.openExternal(url.href);
          }
          return result;
        }
        case 'mcpAuthComplete': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          const result = await mcpAuthComplete(
            { options },
            { serverId: request.serverId, input: request.input },
          );
          return { ok: result.authenticated };
        }
        case 'mcpUpsert': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return upsertMcpServer(options, request);
        }
        case 'mcpDisable': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return disableMcpServer(options, request.serverId);
        }
        case 'mcpRemove': {
          const options = this.connection.options();
          if (!options) throw new Error('The service is not connected.');
          return removeMcpServer(options, request.serverId);
        }
        default: {
          const _exhaustive: never = request;
          throw new Error(`Unsupported service action: ${JSON.stringify(_exhaustive)}`);
        }
      }
    });
  }
}
