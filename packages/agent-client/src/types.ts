import type {
  CapabilityRequest,
  CapabilityResult,
  DesktopCapability,
  InvalidateFrame,
  ServiceEvent,
  SummariesFrame,
  TaskSnapshot,
} from '@ai/agent-contracts';

/** A client that holds the service owner token (desktop main process, CLI) and sends it itself. */
export interface TokenClientOptions {
  baseUrl: string;
  token: string;
}

/**
 * A page whose host relays its requests to the service (the macOS shell's `ai-app:` scheme
 * handler and its stream bridge). The relay adds the credential, so the page holds none.
 */
export interface RelayClientOptions {
  baseUrl: string;
  relay: true;
}

/** Connection options: exactly one way to authenticate, chosen by the caller's host. */
export type AgentClientOptions = TokenClientOptions | RelayClientOptions;

/**
 * Marks a request as the page's own call through the relay. WebKit sends no CORS preflight for a
 * custom scheme, so the relay refuses state-changing requests without this header; every relayed
 * request carries it.
 */
export const RELAY_HEADER = 'x-ai-relay';

/** The authentication headers for one request: the bearer token, or the relay marker. */
export function authHeaders(options: AgentClientOptions): Record<string, string> {
  return 'token' in options
    ? { authorization: `Bearer ${options.token}` }
    : { [RELAY_HEADER]: '1' };
}

/** Typed failure for HTTP error envelopes. */
export class AgentClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AgentClientError';
  }
}

/**
 * Stream callbacks; a snapshot replaces one task's state, summaries replace the task set (without
 * transcripts), and events apply in seq order.
 */
export interface StreamHandlers {
  onSnapshot: (snapshot: TaskSnapshot) => void;
  onSummaries: (frame: SummariesFrame) => void;
  onEvent: (event: ServiceEvent) => void;
  onResumed?: (seq: number) => void;
  onDisconnect?: (reason: string) => void;
  /** Shared data outside the task stream changed; reload the named scope. */
  onInvalidate?: (frame: InvalidateFrame) => void;
}

/** Desktop capability served by this client with a result producer. */
export interface CapabilityHandler {
  capability: DesktopCapability;
  handle: (request: CapabilityRequest) => Promise<CapabilityResult>;
}
