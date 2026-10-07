import {
  mutationOptions,
  useIsMutating,
  useMutation,
  useMutationState,
  type QueryKey,
} from '@tanstack/react-query';
import type {
  MemoryCreateRequest,
  MemoryProposal,
  MemorySaveRequest,
  MemorySettingsRequest,
  MemoryUnit,
} from '@atd/agent-contracts';
import type { MemoryUnitWrite } from '../../client/agent/bridge';
import { bridgeKeys } from '../../lib/bridge-cache';
import { queryClient } from '../../lib/query-client';
import { agentApi } from '../agent/use-agent';
import { readString } from '../service/wire-read';
import { showMemorySnapshot } from './use-memory-snapshot';

const SETTINGS_KEY = ['memory', 'settings'] as const;
/** Creating a unit; `['memory', 'create']` is Create with AI's (`use-memory-create.ts`). */
const NEW_KEY = ['memory', 'new'] as const;
/** Every write to one unit sits under this key, so its row and page wait on any of them. */
const UNIT_KEY = ['memory', 'unit'] as const;
const PROPOSAL_KEY = ['memory', 'proposal'] as const;

const showWrite = ({ snapshot }: MemoryUnitWrite) => showMemorySnapshot(snapshot);

// Each write answers the snapshot it produced, shown before the change event arrives.
const saveSettings = mutationOptions({
  mutationKey: SETTINGS_KEY,
  mutationFn: (settings: MemorySettingsRequest) => agentApi().saveMemorySettings(settings),
  onSuccess: showMemorySnapshot,
});
const createUnit = mutationOptions({
  mutationKey: NEW_KEY,
  mutationFn: (input: MemoryCreateRequest) => agentApi().createMemoryUnit(input),
  onSuccess: showWrite,
});
const saveUnit = mutationOptions({
  mutationKey: [...UNIT_KEY, 'save'],
  mutationFn: ({ input }: { id: string; input: MemorySaveRequest }) =>
    agentApi().saveMemoryUnit(input),
  onSuccess: showWrite,
});
const deleteUnit = mutationOptions({
  mutationKey: [...UNIT_KEY, 'delete'],
  mutationFn: ({ id }: { id: string }) => agentApi().deleteMemoryUnit(id),
  onSuccess: showMemorySnapshot,
});
const toggleUnit = mutationOptions({
  mutationKey: [...UNIT_KEY, 'toggle'],
  mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
    agentApi().toggleMemoryUnit(id, enabled),
  onSuccess: showMemorySnapshot,
});
// Opening a page clears its New badge on the side: the page never waits for it, and a failure
// only leaves the badge for the next opening.
const markReviewed = mutationOptions({
  mutationKey: ['memory', 'reviewed'],
  mutationFn: (id: string) => agentApi().markMemoryUnitReviewed(id),
  onSuccess: showMemorySnapshot,
  meta: { errorToast: false },
});
/**
 * Accepting a skill proposal creates a Personal skill; the write waits until the extension lists
 * read again, so the skill's page opens on a catalog that lists it.
 */
const acceptProposal = mutationOptions({
  mutationKey: [...PROPOSAL_KEY, 'accept'],
  mutationFn: async ({ id }: { id: string }) => {
    const { skill, snapshot } = await agentApi().acceptMemoryProposal(id);
    showMemorySnapshot(snapshot);
    if (skill)
      await queryClient.invalidateQueries({
        queryKey: bridgeKeys.serviceLists,
        refetchType: 'all',
      });
    return skill;
  },
});
const dismissProposal = mutationOptions({
  mutationKey: [...PROPOSAL_KEY, 'dismiss'],
  mutationFn: ({ id }: { id: string }) => agentApi().dismissMemoryProposal(id),
  onSuccess: showMemorySnapshot,
});

/** The ids the pending writes under `key` name, each a unit or proposal waiting on its write. */
function usePendingIds(key: QueryKey): ReadonlySet<string> {
  const ids = useMutationState(
    {
      filters: { mutationKey: key, status: 'pending' },
      select: (mutation) => readString(mutation.state.variables, 'id'),
    },
    queryClient,
  );
  return new Set(ids);
}

/**
 * Memory writes, shared by the Memory section and Personal's Memory tab. A failure shows its error
 * toast; the writes a caller awaits also reject after it. Only the controls in flight wait: the
 * learning switches (`settingsPending`), the New memory page (`creating`), each unit being saved,
 * turned on or off, or deleted (`busyIds`), and each proposal being accepted or dismissed
 * (`proposalBusyIds`), wherever they show.
 */
export function useMemoryWrites() {
  const { mutate: saveSettingsNow } = useMutation(saveSettings, queryClient);
  const { mutateAsync: create } = useMutation(createUnit, queryClient);
  const { mutateAsync: save } = useMutation(saveUnit, queryClient);
  const { mutateAsync: remove } = useMutation(deleteUnit, queryClient);
  const { mutate: toggle } = useMutation(toggleUnit, queryClient);
  const { mutate: review } = useMutation(markReviewed, queryClient);
  const { mutateAsync: accept } = useMutation(acceptProposal, queryClient);
  const { mutate: dismiss } = useMutation(dismissProposal, queryClient);
  return {
    settingsPending: useIsMutating({ mutationKey: SETTINGS_KEY }, queryClient) > 0,
    creating: useIsMutating({ mutationKey: NEW_KEY }, queryClient) > 0,
    busyIds: usePendingIds(UNIT_KEY),
    proposalBusyIds: usePendingIds(PROPOSAL_KEY),
    /** Pauses or resumes learning, or turns Ask before saving on or off. */
    saveSettings: saveSettingsNow,
    /** Creates a unit; resolves with it once the snapshot lists it. */
    create,
    /** Saves the given fields of a unit; a stale revision rejects with the service's message. */
    save: (input: MemorySaveRequest) => save({ id: input.id, input }),
    /** Moves a unit to the memory trash. */
    remove: (unit: MemoryUnit) => remove({ id: unit.id }),
    /** Turns a unit on or off for runs; the switch flipping is the feedback. */
    toggle: (unit: MemoryUnit, enabled: boolean) => toggle({ id: unit.id, enabled }),
    /** Clears a learned unit's New badge, as opening its page does. */
    markReviewed: review,
    /** Applies a proposal; resolves with the Personal skill a skill proposal created. */
    accept: (proposal: MemoryProposal) => accept({ id: proposal.id }),
    /** Drops a proposal without applying it. */
    dismiss: (proposal: MemoryProposal) => dismiss({ id: proposal.id }),
  };
}
