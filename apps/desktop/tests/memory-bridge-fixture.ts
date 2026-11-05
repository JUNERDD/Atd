import { vi } from 'vitest';
import type { AgentBridge, MemorySnapshot } from '../src/client/agent/bridge';

/** Memory with nothing saved, as a fresh data directory has it. */
const noMemory = (): MemorySnapshot => ({
  units: [],
  proposals: [],
  problems: [],
  paused: false,
  askFirst: false,
  error: '',
});

/** Memory bridge defaults; each test may override the individual mocks on its installed bridge. */
export function memoryBridgeFixture(): Pick<
  AgentBridge,
  | 'memory'
  | 'saveMemorySettings'
  | 'createMemoryUnit'
  | 'saveMemoryUnit'
  | 'deleteMemoryUnit'
  | 'toggleMemoryUnit'
  | 'markMemoryUnitReviewed'
  | 'acceptMemoryProposal'
  | 'dismissMemoryProposal'
> {
  return {
    memory: vi.fn(async () => noMemory()),
    saveMemorySettings: vi.fn(async (settings) => ({ ...noMemory(), ...settings })),
    createMemoryUnit: vi.fn(async () => {
      throw new Error('Not used by this interaction');
    }),
    saveMemoryUnit: vi.fn(async () => {
      throw new Error('Not used by this interaction');
    }),
    deleteMemoryUnit: vi.fn(async () => noMemory()),
    toggleMemoryUnit: vi.fn(async () => noMemory()),
    markMemoryUnitReviewed: vi.fn(async () => noMemory()),
    acceptMemoryProposal: vi.fn(async () => ({ skill: null, snapshot: noMemory() })),
    dismissMemoryProposal: vi.fn(async () => noMemory()),
  };
}
