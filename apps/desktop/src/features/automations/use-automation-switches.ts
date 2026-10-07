import { mutationOptions, useMutation, useMutationState } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { AutomationItem, AutomationListResponse } from '@atd/agent-contracts';
import { showErrorToast } from '../../components/toast-store';
import { queryClient } from '../../lib/query-client';
import { readString } from '../service/wire-read';
import { failureWords } from './automation-words';
import { automationKeys, automationsBridge } from './use-automations';

const ROW_SAVE_KEY = ['automations', 'row'] as const;

/** Changes the cached list, so a write's answer shows before the refetch its announcement starts. */
function updateList(update: (list: AutomationListResponse) => AutomationListResponse) {
  queryClient.setQueryData<AutomationListResponse>(automationKeys.list, (list) =>
    list ? update(list) : list,
  );
}

/**
 * The row switch. It names no revision: turning an automation on or off is the person's latest
 * word whatever else changed. A read already on its way could answer with the state from before
 * the write, so it is dropped, and the answer goes into the list at once.
 */
const setEnabled = mutationOptions({
  mutationKey: ROW_SAVE_KEY,
  mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
    automationsBridge().setEnabled(id, enabled),
  onMutate: () => queryClient.cancelQueries({ queryKey: automationKeys.list }),
  onSuccess: (item: AutomationItem) =>
    updateList((list) => ({
      ...list,
      automations: list.automations.map((other) =>
        other.automation.id === item.automation.id ? item : other,
      ),
    })),
  meta: { errorToast: false },
});

/**
 * The overview's switches. Each row waits for its own save (its switch moves when the service
 * answered); a refusal the service names by code is worded, such as a one-time time now past.
 * The global pause shows the asked state at once and keeps it until the list agrees: the list
 * changes now, a read on its way is dropped, and a failure puts back what was there.
 */
export function useAutomationSwitches(t: TFunction<'automations'>) {
  const { mutate } = useMutation(setEnabled, queryClient);
  const toggle = (id: string, enabled: boolean) =>
    mutate({ id, enabled }, { onError: (error) => showErrorToast(failureWords(error, t)) });
  const pending = new Set(
    useMutationState(
      {
        filters: { mutationKey: ROW_SAVE_KEY, status: 'pending' },
        select: (mutation) => readString(mutation.state.variables, 'id'),
      },
      queryClient,
    ),
  );
  const pause = useMutation(
    {
      mutationFn: (paused: boolean) => automationsBridge().setPaused(paused),
      onMutate: async (paused: boolean) => {
        await queryClient.cancelQueries({ queryKey: automationKeys.list });
        const previous = queryClient.getQueryData<AutomationListResponse>(automationKeys.list);
        updateList((list) => ({ ...list, paused }));
        return previous;
      },
      onError: (error, _paused, previous) => {
        if (previous) queryClient.setQueryData(automationKeys.list, previous);
        showErrorToast(failureWords(error, t));
      },
      meta: { errorToast: false },
    },
    queryClient,
  );
  return { toggle, pending, pause };
}
