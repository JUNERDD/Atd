import {
  mutationOptions,
  useIsMutating,
  useMutation,
  useMutationState,
} from '@tanstack/react-query';
import type { MemoryEntry } from '../../client/agent/bridge';
import { queryClient } from '../../lib/query-client';
import { agentApi } from '../agent/use-agent';
import { readString } from '../service/wire-read';
import { showMemorySnapshot } from './use-memory-snapshot';

const PAUSE_KEY = ['memory', 'pause'] as const;
const UPDATE_KEY = ['memory', 'update'] as const;

// Each write answers the new snapshot, shown before its change event arrives.
const pauseMemory = mutationOptions({
  mutationKey: PAUSE_KEY,
  mutationFn: (paused: boolean) => agentApi().pauseMemory(paused),
  onSuccess: showMemorySnapshot,
});
const updateMemory = mutationOptions({
  mutationKey: UPDATE_KEY,
  mutationFn: ({ entry, content }: { id: string; entry: MemoryEntry; content: string }) =>
    agentApi().updateMemory(entry, content),
  onSuccess: showMemorySnapshot,
});

/**
 * Memory writes, shared by the Memory section and Personal's Memory tab. A failure shows its error
 * toast. Only the controls in flight wait: the learning switch (`pausing`) while a pause runs, and
 * each entry being saved or deleted (`savingIds`), wherever it shows.
 */
export function useMemoryWrites() {
  const { mutate: pause } = useMutation(pauseMemory, queryClient);
  const { mutateAsync: update } = useMutation(updateMemory, queryClient);
  const pausing = useIsMutating({ mutationKey: PAUSE_KEY }, queryClient) > 0;
  const saving = useMutationState(
    {
      filters: { mutationKey: UPDATE_KEY, status: 'pending' },
      select: (mutation) => readString(mutation.state.variables, 'id'),
    },
    queryClient,
  );
  return {
    pausing,
    pause,
    savingIds: new Set(saving),
    /** Saves `entry` with new content (empty deletes it); rejects after the failure's toast. */
    update: (entry: MemoryEntry, content: string) => update({ id: entry.id, entry, content }),
  };
}
