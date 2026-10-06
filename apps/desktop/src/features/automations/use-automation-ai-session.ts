import { useTranslation } from 'react-i18next';
import type { AutomationSessionTarget } from '../../client/agent/bridge';
import { showErrorToast, showToast } from '../../components/toast-store';
import { isSkillDisabled } from '../service/extension-rows';

const SKILL = 'create-automation';

/**
 * Create or Edit with AI for the automation editor, as the command editor has: opens a new panel
 * session seeded with the built-in `create-automation` skill, naming the saved automation to change
 * (null creates one). Extensions can switch that skill off, so a disabled skill says so instead of
 * starting.
 */
export function useAutomationAiSession() {
  const { t } = useTranslation('automations');
  return async (automation: AutomationSessionTarget) => {
    const bridge = window.desktop?.settings;
    if (!bridge) return;
    try {
      if (await isSkillDisabled(SKILL)) {
        showToast({ kind: 'error', text: t('session.enableSkill', { name: SKILL }) });
        return;
      }
      await bridge.startAutomationSession(automation);
      showToast({ kind: 'info', text: t('session.opened') });
    } catch (error) {
      showErrorToast(error);
    }
  };
}
