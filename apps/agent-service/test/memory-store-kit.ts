import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MemoryTarget } from '@atd/agent-contracts';
import { MemoryAuthority, type MemoryAuthorityEvents } from '../dist/memory/engine.js';
import type { MemoryRunScope, MemoryUnitInput } from '../dist/memory/engine-types.js';

/**
 * A memory authority on a fresh temporary agent dir, with its notices and run-made changes
 * recorded. `reopen` loads the authority again from the same files; `close` removes the dir.
 */
export async function openMemory() {
  const agentDir = await mkdtemp(path.join(tmpdir(), 'memory-engine-'));
  const notices: string[] = [];
  let changes = 0;
  const events: MemoryAuthorityEvents = {
    notify: (message) => notices.push(message),
    changed: () => {
      changes += 1;
    },
  };
  let memory = await MemoryAuthority.authorityFor(agentDir, events);
  return {
    agentDir,
    root: path.join(agentDir, 'memory'),
    notices,
    events,
    get memory() {
      return memory;
    },
    changes: () => changes,
    async reopen() {
      memory.close();
      memory = await MemoryAuthority.authorityFor(agentDir, events);
      return memory;
    },
    async close() {
      memory.close();
      await rm(agentDir, { recursive: true, force: true });
    },
  };
}

/** The scope of a root run with memory on; `overrides` change any part. */
export function rootScope(overrides: Partial<MemoryRunScope> = {}): MemoryRunScope {
  return {
    runMemory: true,
    executionId: 'root:run-1',
    taskId: 'task-1',
    runId: 'run-1',
    ...overrides,
  };
}

/** A unit input with an English description; `overrides` change any part. */
export function unitInput(
  description: string,
  body: string,
  type: MemoryTarget = 'memory',
  overrides: Partial<MemoryUnitInput> = {},
): MemoryUnitInput {
  return { description, body, type, ...overrides };
}
