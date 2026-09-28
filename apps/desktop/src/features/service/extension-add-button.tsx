import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';

export type ExtensionTab = 'skills' | 'subagents' | 'mcp';

/**
 * Trailing tab-row control: opens the active tab's add page, where the form and Create with AI
 * sit together, as the command list's New button does.
 */
export function ExtensionAddButton({
  tab,
  disabled,
  onAdd,
}: {
  tab: ExtensionTab;
  disabled: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation('settings');
  const label =
    tab === 'skills'
      ? t('extensions.addSkill')
      : tab === 'subagents'
        ? t('extensions.addSubagent')
        : t('extensions.addServer');
  return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onAdd}>
      <Plus data-icon="inline-start" />
      {label}
    </Button>
  );
}
