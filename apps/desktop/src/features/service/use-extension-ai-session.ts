import { useTranslation } from 'react-i18next';
import { showErrorToast, showToast } from '../../components/toast-store';
import type { ExtensionSkillRow } from './extension-rows';
import type { ExtensionItemKind } from './use-extension-route';

/** The panel session each Personal item kind is created or edited in, and its seeding skill. */
const SESSION = {
  skill: { kind: 'skill', skill: 'create-skill' },
  agent: { kind: 'subagent', skill: 'create-subagent' },
  mcp: { kind: 'mcp', skill: 'create-mcp' },
} as const satisfies Record<ExtensionItemKind, { kind: string; skill: string }>;

/**
 * Create or Edit with AI for the Extensions pages: opens a new panel session seeded with the
 * kind's `create-*` skill, naming the item to change when there is one. Extensions can switch that
 * skill off, and its chip would then load nothing, so a disabled skill says so instead of starting.
 */
export function useExtensionAiSession(skills: readonly ExtensionSkillRow[]) {
  const { t } = useTranslation('settings');
  return async (itemKind: ExtensionItemKind, target: string | null) => {
    const bridge = window.desktop?.settings;
    if (!bridge) return;
    const { kind, skill } = SESSION[itemKind];
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
