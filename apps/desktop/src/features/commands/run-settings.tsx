import { useTranslation } from 'react-i18next';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@ai/ui/components/item';
import { ModelConfigPopover } from '../providers/model-config-popover';
import { TOOL_DESCRIPTIONS, type CommandDefinition } from '../../../electron/agent/command-schema';
import type { SettingsSnapshot } from '../../../electron/settings-contract';

/** The command's run policy as an editor form section: model, memory and allowed tools. */
export function RunSettings({
  command,
  onChange,
  settings,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
  settings: SettingsSnapshot | null;
}) {
  const { t } = useTranslation('commands');
  const { t: tCommon } = useTranslation('common');
  const provider = settings?.connections.find(
    (connection) => connection.connectionId === settings.defaultConnectionId,
  );
  const fixedModel = command.model.mode === 'fixed' ? command.model : null;
  return (
    <section className="settings-field" data-figma-node="1062:33204">
      <Label>{t('run.title')}</Label>
      <div className="run-settings">
        <div className="field-columns aligned-fields">
          <div className="settings-field">
            <Label htmlFor="command-model-policy">{t('run.model')}</Label>
            <div className="settings-field">
              <Select
                value={command.model.mode}
                onValueChange={(value) => {
                  if (value === 'inherit') onChange({ ...command, model: { mode: 'inherit' } });
                  else
                    onChange({
                      ...command,
                      model: {
                        mode: 'fixed',
                        connectionId: provider?.connectionId ?? '',
                        modelId: provider?.defaultModel ?? '',
                      },
                    });
                }}
              >
                <SelectTrigger id="command-model-policy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">{t('run.useAppDefault')}</SelectItem>
                  <SelectItem
                    value="fixed"
                    disabled={
                      !settings?.connections.some(
                        (connection) => connection.connected && connection.catalog.length,
                      )
                    }
                  >
                    {t('run.useFixedModel')}
                  </SelectItem>
                </SelectContent>
              </Select>
              {fixedModel && (
                <ModelConfigPopover
                  connections={settings?.connections ?? []}
                  model={fixedModel}
                  thinkingLevel={fixedModel.thinkingLevel ?? 'off'}
                  onModelChange={(reference) =>
                    onChange({ ...command, model: { ...fixedModel, ...reference } })
                  }
                  onThinkingLevelChange={(thinkingLevel) =>
                    onChange({ ...command, model: { ...fixedModel, thinkingLevel } })
                  }
                />
              )}
            </div>
          </div>
          <div className="settings-field">
            <Label htmlFor="command-memory">{t('run.memory')}</Label>
            <Select
              value={command.memory}
              onValueChange={(value) => {
                if (value === 'inherit' || value === 'off') onChange({ ...command, memory: value });
              }}
            >
              <SelectTrigger id="command-memory" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">{t('run.memoryInherit')}</SelectItem>
                <SelectItem value="off">{t('run.memoryOff')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="settings-field">
          <Label>{t('run.allowedTools')}</Label>
          <ItemGroup className="run-settings-tools">
            {TOOL_DESCRIPTIONS.map((tool) => (
              <Item
                asChild
                key={tool.id}
                variant="outline"
                size="sm"
                className="grid grid-cols-[minmax(0,1fr)_auto]"
              >
                <li>
                  <ItemContent>
                    <ItemTitle>{tCommon(`tools.${tool.id}.label`)}</ItemTitle>
                    <ItemDescription>{tCommon(`tools.${tool.id}.description`)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label={tCommon(`tools.${tool.id}.label`)}
                      checked={command.tools.includes(tool.id)}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...command,
                          tools: checked
                            ? [...command.tools, tool.id]
                            : command.tools.filter((id) => id !== tool.id),
                        })
                      }
                    />
                  </ItemActions>
                </li>
              </Item>
            ))}
          </ItemGroup>
        </div>
      </div>
    </section>
  );
}
