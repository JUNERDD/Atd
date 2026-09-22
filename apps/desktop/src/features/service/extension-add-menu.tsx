import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';

export type ExtensionTab = 'skills' | 'subagents' | 'mcp';

/** Trailing tab-row control: open a form or hand off create-with-AI to the panel. */
export function ExtensionAddMenu({
  tab,
  disabled,
  onFillForm,
  onCreateWithAi,
}: {
  tab: ExtensionTab;
  disabled: boolean;
  onFillForm: () => void;
  onCreateWithAi: () => void;
}) {
  const { t } = useTranslation('settings');
  const addLabel =
    tab === 'skills'
      ? t('extensions.addSkill')
      : tab === 'subagents'
        ? t('extensions.addSubagent')
        : t('extensions.addServer');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          {addLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} collisionPadding={8}>
        <DropdownMenuItem disabled={disabled} onSelect={onFillForm}>
          {t('extensions.fillForm')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onSelect={onCreateWithAi}>
          {t('extensions.createWithAi')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
