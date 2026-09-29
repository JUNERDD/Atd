import { AgentHttpClient, AgentStreamClient, type AgentClientOptions } from '@ai/agent-client';
import type {
  InvalidateFrame,
  ServiceEvent,
  SummariesFrame,
  TaskSnapshot,
} from '@ai/agent-contracts';
import type { AgentConnection } from '../../electron/agent/agent-requests';
import type { ServiceState, ServiceStatusView } from '../../electron/service/ipc';

interface TaskHandlers {
  onSnapshot: (snapshot: TaskSnapshot) => void;
  onSummaries: (frame: SummariesFrame) => void;
  onEvent: (event: ServiceEvent) => void;
}

/**
 * The web host's link to the service: one HTTP client and one stream with the options its host
 * supplies. It serves no desktop capabilities (file picker, selection, clipboard); runs that
 * need them wait for the desktop app. The stream reconnects on its own.
 */
export class WebConnection implements AgentConnection {
  private readonly httpClient: AgentHttpClient;
  private readonly stream: AgentStreamClient;
  private handlers: TaskHandlers | null = null;
  private state: ServiceState = 'connecting';
  private detail = '';
  private readonly statusListeners = new Set<(status: ServiceStatusView) => void>();
  private readonly invalidateListeners = new Set<(frame: InvalidateFrame) => void>();
  private readonly connectedListeners = new Set<() => void>();

  constructor(
    private readonly clientOptions: AgentClientOptions,
    private readonly serviceId: string,
  ) {
    this.httpClient = new AgentHttpClient(clientOptions);
    this.stream = new AgentStreamClient(clientOptions, {
      onSnapshot: (snapshot) => {
        this.setState('connected');
        this.handlers?.onSnapshot(snapshot);
      },
      onSummaries: (frame) => {
        this.setState('connected');
        this.handlers?.onSummaries(frame);
      },
      onEvent: (event) => {
        this.setState('connected');
        this.handlers?.onEvent(event);
      },
      onResumed: () => this.setState('connected'),
      onInvalidate: (frame) => {
        for (const listener of this.invalidateListeners) listener(frame);
      },
      onDisconnect: (reason) => this.setState('reconnecting', reason),
    });
  }

  /** Session setup already reached the service over HTTP, so the page starts connected. */
  connect() {
    this.stream.connect();
    this.setState('connected');
  }

  http(): AgentHttpClient {
    return this.httpClient;
  }

  options(): AgentClientOptions {
    return this.clientOptions;
  }

  setTaskHandlers(handlers: TaskHandlers) {
    this.handlers = handlers;
  }

  unavailable(): string {
    return this.state === 'reconnecting' ? this.detail : '';
  }

  status(): ServiceStatusView {
    return {
      state: this.state,
      detail: this.detail,
      serviceId: this.serviceId,
      epoch: this.stream.epoch || null,
      draining: false,
      activeRuns: 0,
      pendingConfirms: 0,
      pendingCapabilities: 0,
      dataDir: null,
      baseUrl: this.clientOptions.baseUrl,
      stream: { epoch: this.stream.epoch, seq: this.stream.seq },
    };
  }

  onStatus(listener: (status: ServiceStatusView) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onInvalidate(listener: (frame: InvalidateFrame) => void): () => void {
    this.invalidateListeners.add(listener);
    return () => this.invalidateListeners.delete(listener);
  }

  /** Every transition to connected: the first stream, and each one after a drop. */
  onConnected(listener: () => void): () => void {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  private setState(state: ServiceState, detail = '') {
    const connected = state === 'connected' && this.state !== 'connected';
    if (state === this.state && detail === this.detail) return;
    this.state = state;
    this.detail = detail;
    const status = this.status();
    for (const listener of this.statusListeners) listener(status);
    if (connected) for (const listener of this.connectedListeners) listener();
  }
}
