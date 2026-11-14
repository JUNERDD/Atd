import { providerStatus, type AgentClientOptions } from '@atd/agent-client';
import type { Connection } from './schema';

export interface StatusProbeState {
  options: AgentClientOptions;
  defaultConnectionId: string | null;
  connections: readonly Connection[];
  isEligible: (item: Connection) => boolean;
  probedIds: Set<string>;
  markProbedOnce: () => void;
  changed: () => void;
  sync: () => Promise<void>;
}

/** Probes keyring readability sequentially across unprobed credentialed rows, stopping on unreadable or network errors. */
export async function probeCredentialStatuses(state: StatusProbeState): Promise<void> {
  const eligible = state.connections.filter((item) => state.isEligible(item));
  if (!eligible.length) {
    state.markProbedOnce();
    state.changed();
    return;
  }
  if (eligible.some((item) => item.credentialIssue === 'unreadable')) {
    state.markProbedOnce();
    return;
  }
  const defaultId = state.defaultConnectionId;
  const pending = eligible
    .filter((item) => !state.probedIds.has(item.connectionId))
    .sort((a, b) => Number(b.connectionId === defaultId) - Number(a.connectionId === defaultId));
  if (!pending.length) {
    state.markProbedOnce();
    state.changed();
    return;
  }
  let issueChanged = false;
  let networkFailed = false;
  for (const item of pending) {
    const status = await providerStatus(state.options, item.connectionId).catch(() => null);
    if (status === null) {
      networkFailed = true;
      break;
    }
    state.markProbedOnce();
    state.probedIds.add(item.connectionId);
    if (status.credentialIssue !== item.credentialIssue) issueChanged = true;
    if (status.credentialIssue === 'unreadable') break;
  }
  if (issueChanged || networkFailed) {
    await state.sync();
  } else {
    state.changed();
  }
}
