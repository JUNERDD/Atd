import { mutationOptions, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../components/toast-store';
import { queryClient } from '../../lib/query-client';
import { isSkillDisabled } from '../service/extension-rows';

const SKILL = 'create-memory';

/** Where a Create-with-AI request ended: opened, or why it could not open. */
type MemoryCreateOutcome = 'paused' | 'skillDisabled' | 'openedHere' | 'requested';

const startMemoryCreate = mutationOptions({
  mutationKey: ['memory', 'create'],
  mutationFn: async ({
    paused,
    open,
  }: {
    paused: boolean | null;
    open: (() => void) | undefined;
  }): Promise<MemoryCreateOutcome> => {
    const blocked = paused ?? (await window.desktop?.agent?.memory())?.paused ?? false;
    if (blocked) return 'paused';
    if (await isSkillDisabled(SKILL)) return 'skillDisabled';
    if (open) {
      open();
      return 'openedHere';
    }
    await window.desktop?.settings.startExtensionSession('memory');
    return 'requested';
  },
});

/**
 * Create-with-AI for memory: opens a new panel session seeded with the built-in `create-memory`
 * skill, which saves or updates a memory through the memory tools. Pausing learning blocks those
 * tools as well, so a paused memory says why instead of opening a session that cannot save.
 * `paused` is what the caller already shows; null reads it from the agent's memory snapshot.
 * `open` seeds the session itself, for a caller inside the panel (which receives no session
 * message of its own); by default the session is requested from the panel window. A failure shows
 * its error toast.
 */
export function useMemoryCreate() {
  const { t } = useTranslation('memory');
  const { mutate, isPending } = useMutation(startMemoryCreate, queryClient);
  const start = (paused: boolean | null, open?: () => void) => {
    if (!window.desktop?.settings) return;
    mutate(
      { paused, open },
      {
        onSuccess: (outcome) => {
          if (outcome === 'paused')
            showToast({ kind: 'error', text: t('memory.create.pausedHint') });
          else if (outcome === 'skillDisabled')
            showToast({ kind: 'error', text: t('memory.create.enableSkill', { name: SKILL }) });
          else if (outcome === 'requested')
            showToast({ kind: 'info', text: t('memory.create.opened') });
        },
      },
    );
  };
  return { starting: isPending, start };
}
