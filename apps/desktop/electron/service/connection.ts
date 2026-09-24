import { AgentHttpClient, AgentStreamClient, type AgentClientOptions } from '@ai/agent-client';
import type {
  CapabilityRequest,
  ServiceEvent,
  StatusResponse,
  TaskSnapshot,
} from '@ai/agent-contracts';
import { discoverService, type ServiceEndpoint } from './endpoint';
import { handleCapability, type CapabilityContext } from './capabilities';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface ServiceStatus {
  state: ConnectionState;
  detail: string;
  service: StatusResponse | null;
  endpoint: { dataDir: string; baseUrl: string; serviceId: string; epoch: number } | null;
  stream: { epoch: number; seq: number };
}

export interface ConnectionEvents {
  onStatus: (status: ServiceStatus) => void;
  onSnapshot: (snapshot: TaskSnapshot) => void;
  onEvent: (event: ServiceEvent) => void;
}

/**
 * Main-owned service connection. Holds the bearer token from the 0600 token
 * file; the renderer never sees it. HTTP verifies identity/version; WS
 * carries task events, confirms and capability requests with epoch/seq
 * resume. App quit stops the service through ServiceManager.shutdown.
 */
export class ServiceConnection {
  private endpoint: ServiceEndpoint | null = null;
  private httpClient: AgentHttpClient | null = null;
  private stream: AgentStreamClient | null = null;
  private state: ConnectionState = 'connecting';
  private detail = 'Starting the agent service…';
  private connectBusy = false;
  private service: StatusResponse | null = null;
  private readonly connectedListeners = new Set<() => void>();

  constructor(
    private events: ConnectionEvents,
    private readonly caps: Omit<CapabilityContext, 'http'>,
  ) {}

  /** Lets the task client attach snapshot/event handlers to the shared stream. */
  setTaskHandlers(handlers: Pick<ConnectionEvents, 'onSnapshot' | 'onEvent'>) {
    this.events = { ...this.events, ...handlers };
  }

  status(): ServiceStatus {
    return {
      state: this.state,
      detail: this.detail,
      service: this.service,
      endpoint: this.endpoint
        ? {
            dataDir: this.endpoint.dataDir,
            baseUrl: this.endpoint.baseUrl,
            serviceId: this.endpoint.serviceId,
            epoch: this.endpoint.epoch,
          }
        : null,
      stream: { epoch: this.stream?.epoch ?? 0, seq: this.stream?.seq ?? 0 },
    };
  }

  /**
   * Runs `listener` on every transition to connected: the first connect, a reconnect, and a
   * resumed stream after a drop. A restarted service loses in-memory state, so owners of state
   * the service holds only in memory (the user shell allowlist) push it again here.
   */
  onConnected(listener: () => void): () => void {
    this.connectedListeners.add(listener);
    return () => {
      this.connectedListeners.delete(listener);
    };
  }

  http(): AgentHttpClient | null {
    return this.httpClient;
  }

  options(): AgentClientOptions | null {
    return this.endpoint ? { baseUrl: this.endpoint.baseUrl, token: this.endpoint.token } : null;
  }

  private publish() {
    this.events.onStatus(this.status());
  }

  private setState(state: ConnectionState, detail = '') {
    const connected = state === 'connected' && this.state !== 'connected';
    this.state = state;
    this.detail = detail;
    this.publish();
    if (connected) for (const listener of this.connectedListeners) listener();
  }

  /** Records a startup failure after a spawn attempt. The renderer can show it. */
  fail(detail: string): void {
    this.closeStream();
    this.endpoint = null;
    this.httpClient = null;
    this.service = null;
    this.setState('disconnected', detail);
  }

  /**
   * Marks startup work (stop/spawn) before the first connect attempt, so the
   * renderer shows connecting instead of a transient disconnected error.
   */
  markStarting(detail = 'Starting the agent service…'): void {
    this.setState('connecting', detail);
  }

  /** Connects to the service in dataDir; throws with a user-facing message. */
  async connect(dataDir: string, options?: { quiet?: boolean }): Promise<ServiceStatus> {
    if (this.connectBusy) throw new Error('A connection attempt is already running.');
    this.connectBusy = true;
    this.setState('connecting', 'Connecting to the agent service…');
    try {
      const endpoint = await discoverService(dataDir);
      const clientOptions: AgentClientOptions = {
        baseUrl: endpoint.baseUrl,
        token: endpoint.token,
      };
      const http = new AgentHttpClient(clientOptions);
      const status = await http.status();
      if (status.service.serviceId !== endpoint.serviceId)
        throw new Error('The service identity changed during connection.');
      this.endpoint = endpoint;
      this.httpClient = http;
      this.service = status;
      this.openStream(clientOptions);
      this.setState('connected', '');
      return this.status();
    } catch (error) {
      this.closeStream();
      this.endpoint = null;
      this.httpClient = null;
      this.service = null;
      const message = error instanceof Error ? error.message : 'Could not connect to the service.';
      if (options?.quiet) {
        // Startup probe before a spawn: stay connecting so the panel never
        // flashes a disconnected error with an empty detail.
        this.setState('connecting', 'Starting the agent service…');
      } else {
        this.setState('disconnected', message);
      }
      throw new Error(message);
    } finally {
      this.connectBusy = false;
    }
  }

  /** Disconnects the client only; service tasks keep running. */
  disconnect(detail = ''): ServiceStatus {
    this.closeStream();
    this.endpoint = null;
    this.httpClient = null;
    this.service = null;
    this.setState('disconnected', detail);
    return this.status();
  }

  /** Refreshes /v1/status; surfaces draining/active/pending to the UI. */
  async refresh(): Promise<ServiceStatus> {
    if (!this.httpClient || !this.endpoint) throw new Error('The service is not connected.');
    try {
      this.service = await this.httpClient.status();
      if (this.service.service.serviceId !== this.endpoint.serviceId)
        throw new Error('The service identity changed.');
      if (this.state !== 'connected') this.setState('connected', '');
      else this.publish();
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The service is unreachable.';
      this.setState('reconnecting', message);
      throw new Error(message);
    }
  }

  private openStream(options: AgentClientOptions) {
    this.closeStream();
    const caps: CapabilityContext = { ...this.caps, http: () => this.httpClient };
    const stream = new AgentStreamClient(
      options,
      {
        onSnapshot: (snapshot) => {
          if (this.state === 'reconnecting') this.setState('connected', '');
          this.events.onSnapshot(snapshot);
        },
        onEvent: (event) => this.events.onEvent(event),
        onResumed: () => {
          if (this.state === 'reconnecting') this.setState('connected', '');
          else this.publish();
        },
        onDisconnect: (reason) => {
          if (this.state === 'connected') this.setState('reconnecting', reason);
          else {
            this.detail = reason;
            this.publish();
          }
        },
      },
      [],
      (
        ['file.pick', 'file.save', 'selection.read', 'clipboard.read', 'clipboard.write'] as const
      ).map((capability) => ({
        capability,
        handle: (request: CapabilityRequest) => handleCapability(request, caps),
      })),
    );
    this.stream = stream;
    stream.connect();
  }

  private closeStream() {
    try {
      this.stream?.close();
    } catch {
      // Closing a dead socket is not a connection error.
    }
    this.stream = null;
  }
}
