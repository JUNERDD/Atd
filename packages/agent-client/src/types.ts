import type {
  CapabilityRequest,
  CapabilityResult,
  DesktopCapability,
  ServiceEvent,
  TaskSnapshot,
} from '@ai/agent-contracts';

/** Connection options; the token comes from the service auth file or pairing. */
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
}

/** Desktop capability served by this client with a result producer. */
export interface CapabilityHandler {
  capability: DesktopCapability;
  handle: (request: CapabilityRequest) => Promise<CapabilityResult>;
}
