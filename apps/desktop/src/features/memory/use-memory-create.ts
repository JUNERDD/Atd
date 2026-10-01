import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showErrorToast, showToast } from '../../components/toast-store';
import { isSkillDisabled } from '../service/extension-rows';

const SKILL = 'create-memory';

/**
 * Create-with-AI for memory: opens a new panel session seeded with the built-in `create-memory`
 * skill, which saves or updates a memory through the memory tools. Pausing learning blocks those
 * tools as well, so a paused memory says why instead of opening a session that cannot save.
 * `paused` is what the caller already shows; null reads it from the agent's memory snapshot.
 * `open` seeds the session itself, for a caller inside the panel (which receives no session
 * message of its own); by default the session is requested from the panel window.
 */
export function useMemoryCreate() {
  const { t } = useTranslation('memory');
  const [starting, setStarting] = useState(false);
  const start = useCallback(
    async (paused: boolean | null, open?: () => void) => {
      const bridge = window.desktop?.settings;
      if (!bridge) return;
      setStarting(true);
      try {
        const blocked = paused ?? (await window.desktop?.agent?.memory())?.paused ?? false;
        if (blocked) {
          showToast({ kind: 'error', text: t('memory.create.pausedHint') });
          return;
        }
        if (await isSkillDisabled(SKILL)) {
          showToast({ kind: 'error', text: t('memory.create.enableSkill', { name: SKILL }) });
          return;
        }
        if (open) {
          open();
          return;
        }
        await bridge.startExtensionSession('memory');
        showToast({ kind: 'info', text: t('memory.create.opened') });
      } catch (error) {
        showErrorToast(error);
      } finally {
        setStarting(false);
      }
    },
    [t],
  );
  return { starting, start };
}
