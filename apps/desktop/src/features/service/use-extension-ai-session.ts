import { useTranslation } from 'react-i18next';
import { showErrorToast, showToast } from '../../components/toast-store';
import type { ExtensionTab } from './extension-add-button';
import type { ExtensionSkillRow } from './extension-rows';

const SESSION = {
  skills: { kind: 'skill', skill: 'create-skill' },
  subagents: { kind: 'subagent', skill: 'create-subagent' },
  mcp: { kind: 'mcp', skill: 'create-mcp' },
} as const satisfies Record<ExtensionTab, { kind: string; skill: string }>;

/**
 * Create or Edit with AI for the Extensions pages: opens a new panel session seeded with the tab's
 * `create-*` skill, naming the item to change when there is one. Extensions can switch that skill
 * off, and its chip would then load nothing, so a disabled skill says so instead of starting.
 */
export function useExtensionAiSession(skills: readonly ExtensionSkillRow[]) {
  const { t } = useTranslation('settings');
  return async (tab: ExtensionTab, target: string | null) => {
    const bridge = window.desktop?.settings;
    if (!bridge) return;
    const { kind, skill } = SESSION[tab];
    const row = skills.find((item) => item.name === skill);
    if (row && !row.enabled) {
      showToast({ kind: 'error', text: t('extensions.enableCreateSkill', { name: skill }) });
      return;
    }
    try {
      await bridge.startExtensionSession(kind, target);
      showToast({ kind: 'info', text: t('extensions.sessionOpened') });
    } catch (error) {
      showErrorToast(error);
    }
  };
}
