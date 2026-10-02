import { useTranslation } from 'react-i18next';
import { showErrorToast, showToast } from '../../components/toast-store';
import { isSkillDisabled } from '../service/extension-rows';

const SKILL = 'create-command';

/**
 * Create or Edit with AI for the command editor: opens a new panel session seeded with the
 * built-in `create-command` skill, naming the saved command to change (null creates one).
 * Extensions can switch that skill off, so a disabled skill says so instead of starting.
 */
export function useCommandAiSession() {
  const { t } = useTranslation('commands');
  return async (commandId: string | null) => {
    const bridge = window.desktop?.settings;
    if (!bridge) return;
    try {
      if (await isSkillDisabled(SKILL)) {
        showToast({ kind: 'error', text: t('session.enableSkill', { name: SKILL }) });
        return;
      }
      await bridge.startCommandSession(commandId);
      showToast({ kind: 'info', text: t('session.opened') });
    } catch (error) {
      showErrorToast(error);
    }
  };
}
