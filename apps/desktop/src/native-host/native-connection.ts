import {
  AgentHttpClient,
  AgentStreamClient,
  type AgentClientOptions,
  type AgentStreamOptions,
} from '@ai/agent-client';
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
 * The WebView host's link to the service: one HTTP client and one stream, both through the shell's
 * relay. The shell owns the service process and the credential, so the page only reports what the
 * stream sees: `connecting` until the first stream frame (the shell may still be starting the
 * service), then `connected`, and `reconnecting` after a later drop. The stream registers no
 * capabilities: the shell serves file, clipboard and selection requests on its own connection.
 */
export class NativeConnection implements AgentConnection {
  private readonly httpClient: AgentHttpClient;
  private readonly stream: AgentStreamClient;
  private handlers: TaskHandlers | null = null;
  private state: ServiceState = 'connecting';
  private detail = '';
  private reached = false;
  private readonly statusListeners = new Set<(status: ServiceStatusView) => void>();
  private readonly invalidateListeners = new Set<(frame: InvalidateFrame) => void>();
  private readonly connectedListeners = new Set<() => void>();

  constructor(private readonly clientOptions: AgentStreamOptions) {
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
      // Until the service first answered, a drop is part of starting up, not a lost connection.
      onDisconnect: (reason) => this.setState(this.reached ? 'reconnecting' : 'connecting', reason),
    });
  }

  connect() {
    this.stream.connect();
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

  /** The shell holds the service identity and data directory; the page reports neither. */
  status(): ServiceStatusView {
    return {
      state: this.state,
      detail: this.detail,
      serviceId: null,
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
    if (connected) this.reached = true;
    this.state = state;
    this.detail = detail;
    const status = this.status();
    for (const listener of this.statusListeners) listener(status);
    if (connected) for (const listener of this.connectedListeners) listener();
  }
}
