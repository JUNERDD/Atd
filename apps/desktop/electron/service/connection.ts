import log from 'electron-log/main';
import {
  AgentHttpClient,
  AgentStreamClient,
  type AgentClientOptions,
  type TokenClientOptions,
} from '@ai/agent-client';
import type {
  CapabilityRequest,
  InvalidateFrame,
  ServiceEvent,
  StatusResponse,
  SummariesFrame,
  TaskSnapshot,
} from '@ai/agent-contracts';
import { discoverService, type ServiceEndpoint } from './endpoint';
import { handleCapability, type CapabilityContext } from './capabilities';

const logger = log.scope('service');

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
  onSummaries: (frame: SummariesFrame) => void;
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
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();
  private readonly invalidateListeners = new Set<(frame: InvalidateFrame) => void>();

  constructor(
    private events: ConnectionEvents,
    private readonly caps: Omit<CapabilityContext, 'http'>,
  ) {}

  /** Lets the task client attach snapshot/summaries/event handlers to the shared stream. */
  setTaskHandlers(handlers: Pick<ConnectionEvents, 'onSnapshot' | 'onSummaries' | 'onEvent'>) {
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

  /** Runs `listener` whenever the connection state is set, including a repeated state. */
  onState(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Runs `listener` for every `invalidate` frame: shared data (settings, commands, providers,
   * extensions, memory, a task) changed, whichever client changed it.
   */
  onInvalidate(listener: (frame: InvalidateFrame) => void): () => void {
    this.invalidateListeners.add(listener);
    return () => {
      this.invalidateListeners.delete(listener);
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
    for (const listener of this.stateListeners) listener(state);
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
   * Marks startup work (stop/spawn/restart) before the next connect attempt, so the
   * renderer shows connecting instead of a transient disconnected error. Drops the
   * previous endpoint and stream: their service is gone or about to be replaced, and
   * a stream still retrying its old port would overwrite `detail` with close reasons.
   */
  markStarting(detail = 'Starting the agent service…'): void {
    this.closeStream();
    this.endpoint = null;
    this.httpClient = null;
    this.service = null;
    this.setState('connecting', detail);
  }

  /** Connects to the service in dataDir; throws with a user-facing message. */
  async connect(dataDir: string, options?: { quiet?: boolean }): Promise<ServiceStatus> {
    if (this.connectBusy) throw new Error('A connection attempt is already running.');
    this.connectBusy = true;
    this.setState('connecting', 'Connecting to the agent service…');
    try {
      const endpoint = await discoverService(dataDir);
      const clientOptions: TokenClientOptions = {
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

  private openStream(options: TokenClientOptions) {
    this.closeStream();
    const caps: CapabilityContext = { ...this.caps, http: () => this.httpClient };
    const stream = new AgentStreamClient(
      options,
      {
        onSnapshot: (snapshot) => {
          if (this.state === 'reconnecting') this.setState('connected', '');
          this.events.onSnapshot(snapshot);
        },
        onSummaries: (frame) => {
          if (this.state === 'reconnecting') this.setState('connected', '');
          this.events.onSummaries(frame);
        },
        onEvent: (event) => this.events.onEvent(event),
        onInvalidate: (frame) => {
          for (const listener of this.invalidateListeners) listener(frame);
        },
        onResumed: () => {
          if (this.state === 'reconnecting') this.setState('connected', '');
          else this.publish();
        },
        onDisconnect: (reason) => {
          // The banner shows only that the stream is reconnecting; the close reason goes to the
          // log once per drop, not on every retry.
          if (this.state === 'connected') {
            logger.warn(`The service stream dropped: ${reason}`);
            this.setState('reconnecting', reason);
          } else {
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
