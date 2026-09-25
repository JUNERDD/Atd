import type {
  CapabilityRequest,
  CapabilityResult,
  DesktopCapability,
  InvalidateFrame,
  ServiceEvent,
  TaskSnapshot,
} from '@ai/agent-contracts';

/**
 * Connection options. The token is the service owner token (desktop, CLI) or a paired browser
 * session token; both travel as `Authorization: Bearer`.
 */
export interface AgentClientOptions {
  baseUrl: string;
  token: string;
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

/** Stream callbacks; snapshot replaces state, events apply in seq order. */
export interface StreamHandlers {
  onSnapshot: (snapshot: TaskSnapshot) => void;
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
