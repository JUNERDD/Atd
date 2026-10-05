import {
  acceptMemoryProposal,
  createMemoryUnit,
  deleteMemoryUnit,
  dismissMemoryProposal,
  markMemoryUnitReviewed,
  readMemoryState,
  saveMemorySettings,
  saveMemoryUnit,
  toggleMemoryUnit,
  type AgentClientOptions,
} from '@atd/agent-client';
import type {
  AgentRequest,
  MemoryProposalAccepted,
  MemorySnapshot,
  MemoryUnitWrite,
} from './bridge';
import { manageError, notConnected } from './service-manage';

const MEMORY_ACTIONS = [
  'memory',
  'saveMemorySettings',
  'createMemoryUnit',
  'saveMemoryUnit',
  'deleteMemoryUnit',
  'toggleMemoryUnit',
  'markMemoryUnitReviewed',
  'acceptMemoryProposal',
  'dismissMemoryProposal',
] as const satisfies readonly AgentRequest['action'][];

/** The agent requests that read or change memory; `runMemoryRequest` answers each. */
export type MemoryRequest = Extract<AgentRequest, { action: (typeof MEMORY_ACTIONS)[number] }>;
type MemoryWrite = Exclude<MemoryRequest, { action: 'memory' }>;

export function isMemoryRequest(request: AgentRequest): request is MemoryRequest {
  return MEMORY_ACTIONS.some((action) => action === request.action);
}

/**
 * Reads memory. A failed read, or no connection (`options` is null), is reported inside the
 * snapshot, never thrown, so every page shows the reason in place.
 */
export async function loadMemory(options: AgentClientOptions | null): Promise<MemorySnapshot> {
  try {
    if (!options) throw notConnected();
    const { units, proposals, problems, paused, askFirst } = await readMemoryState(options);
    return { units, proposals, problems, paused, askFirst, error: '' };
  } catch (error) {
    return {
      units: [],
      proposals: [],
      problems: [],
      paused: false,
      askFirst: false,
      error: error instanceof Error ? error.message : 'Memory could not be loaded.',
    };
  }
}

/**
 * Runs one memory request. A write is followed by a read of the memory it changed, so the caller
 * can publish that snapshot before the service's change event arrives; the answer is the snapshot,
 * or the write's result around it. A refused write rejects with the service's message (a stale
 * revision answers 409 with "This memory changed…") and reads nothing.
 */
export async function runMemoryRequest(
  options: AgentClientOptions | null,
  request: MemoryRequest,
): Promise<{ snapshot: MemorySnapshot; answer: unknown }> {
  if (request.action === 'memory') {
    const snapshot = await loadMemory(options);
    return { snapshot, answer: snapshot };
  }
  if (!options) throw notConnected();
  const answer = await write(options, request);
  const snapshot = await loadMemory(options);
  return { snapshot, answer: answer(snapshot) };
}

/** Sends one write; resolves with how its answer wraps the snapshot read after it. */
async function write(
  options: AgentClientOptions,
  request: MemoryWrite,
): Promise<(snapshot: MemorySnapshot) => unknown> {
  const snapshotOnly = (snapshot: MemorySnapshot) => snapshot;
  try {
    switch (request.action) {
      case 'saveMemorySettings':
        await saveMemorySettings(options, request.settings);
        return snapshotOnly;
      case 'createMemoryUnit': {
        const { unit } = await createMemoryUnit(options, request.input);
        return (snapshot): MemoryUnitWrite => ({ unit, snapshot });
      }
      case 'saveMemoryUnit': {
        const { unit } = await saveMemoryUnit(options, request.input);
        return (snapshot): MemoryUnitWrite => ({ unit, snapshot });
      }
      case 'deleteMemoryUnit':
        await deleteMemoryUnit(options, request.id);
        return snapshotOnly;
      case 'toggleMemoryUnit':
        await toggleMemoryUnit(options, request.id, request.enabled);
        return snapshotOnly;
      case 'markMemoryUnitReviewed':
        await markMemoryUnitReviewed(options, request.id);
        return snapshotOnly;
      case 'acceptMemoryProposal': {
        const { skill } = await acceptMemoryProposal(options, request.id);
        return (snapshot): MemoryProposalAccepted => ({ skill: skill?.name ?? null, snapshot });
      }
      case 'dismissMemoryProposal':
        await dismissMemoryProposal(options, request.id);
        return snapshotOnly;
    }
  } catch (error) {
    manageError(error);
  }
}
