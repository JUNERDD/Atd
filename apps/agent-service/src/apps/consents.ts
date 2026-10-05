import { randomUUID } from 'node:crypto';
import {
  APP_CAPABILITIES,
  type AppCapabilityConsent,
  type Capability,
  type GrantState,
} from '@atd/agent-contracts';
import { capabilityDenied } from './errors.js';

/** How long a capability request waits for the user's consent before it is denied. */
export const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

type Outcome = GrantState | 'timeout' | 'aborted';

interface Pending {
  consent: AppCapabilityConsent;
  waiters: Set<(outcome: Outcome) => void>;
}

/**
 * Pending capability consents (`AppSummary.consents`). They belong to the app, not to a task:
 * the first request for a capability the user never answered creates one, later requests for
 * the same capability wait on it, and `PATCH /v1/apps/:appId/grants` settles every waiter at
 * once. A waiter that times out (`CONSENT_TIMEOUT_MS`) or is cancelled leaves; a consent without
 * waiters disappears. `changed` fires whenever the list of pending consents changes. In memory
 * only: a service restart drops pending consents together with the backends that waited.
 */
export class AppConsents {
  private readonly pending = new Map<string, Map<Capability, Pending>>();

  constructor(private readonly changed: () => void) {}

  /** The app's pending consents, oldest first. */
  list(appId: string): AppCapabilityConsent[] {
    return [...(this.pending.get(appId)?.values() ?? [])]
      .map((entry) => entry.consent)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Waits for the user's answer to `capability`; resolves when granted, throws
   * `app_capability_denied` on a denial, the timeout, or `signal`.
   */
  async wait(
    request: { appId: string; appName: string; capability: Capability; purpose?: string },
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const byCap = this.pending.get(request.appId) ?? new Map<Capability, Pending>();
    this.pending.set(request.appId, byCap);
    let entry = byCap.get(request.capability);
    if (!entry) {
      entry = {
        consent: {
          id: randomUUID(),
          kind: 'app.capability',
          appId: request.appId,
          appName: request.appName,
          capability: request.capability,
          ...(request.purpose ? { purpose: request.purpose } : {}),
          createdAt: new Date().toISOString(),
        },
        waiters: new Set(),
      };
      byCap.set(request.capability, entry);
      this.changed();
    }
    const pending = entry;
    const outcome = await new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => finish('timeout'), CONSENT_TIMEOUT_MS);
      const onAbort = () => finish('aborted');
      const finish = (state: Outcome) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        pending.waiters.delete(finish);
        if (!pending.waiters.size && state !== 'granted' && state !== 'denied')
          this.drop(request.appId, request.capability, pending);
        resolve(state);
      };
      pending.waiters.add(finish);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    if (outcome === 'granted') return;
    if (outcome === 'aborted') signal.throwIfAborted();
    throw capabilityDenied(
      outcome === 'timeout'
        ? `Nobody answered the request to use "${request.capability}" in time.`
        : `The user denied this app the "${request.capability}" capability.`,
    );
  }

  /** Settles the waiters of answered capabilities and removes their consents. */
  answer(appId: string, answers: Partial<Record<Capability, GrantState>>): void {
    const byCap = this.pending.get(appId);
    if (!byCap) return;
    let removed = false;
    for (const capability of APP_CAPABILITIES) {
      const state = answers[capability];
      const entry = byCap.get(capability);
      if (!state || !entry) continue;
      byCap.delete(capability);
      removed = true;
      // Each waiter removes itself; a Set iteration tolerates deleting the current entry.
      for (const waiter of entry.waiters) waiter(state);
    }
    if (!byCap.size) this.pending.delete(appId);
    if (removed) this.changed();
  }

  /** Denies and forgets every pending consent of a deleted app. */
  forget(appId: string): void {
    const byCap = this.pending.get(appId);
    if (!byCap) return;
    const answers: Partial<Record<Capability, GrantState>> = {};
    for (const capability of byCap.keys()) answers[capability] = 'denied';
    this.answer(appId, answers);
  }

  private drop(appId: string, capability: Capability, entry: Pending): void {
    const byCap = this.pending.get(appId);
    if (byCap?.get(capability) !== entry) return;
    byCap.delete(capability);
    if (!byCap.size) this.pending.delete(appId);
    this.changed();
  }
}
