import { useTranslation } from 'react-i18next';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { ModelConfigPopover } from '../providers/model-config-popover';
import { SettingsGroup } from '../settings/settings-group';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { TOOL_DESCRIPTIONS, type CommandDefinition } from '../../client/agent/command-schema';
import type { SettingsSnapshot } from '../../client/settings-contract';

/** The command's run policy as an editor group: model, memory and allowed tools. */
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
    <SettingsGroup id="command-run" title={t('run.title')} description={t('run.description')}>
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
          <Label id="command-tools-label">{t('run.allowedTools')}</Label>
          <Card size="sm" className="settings-card">
            <ItemGroup aria-labelledby="command-tools-label">
              {TOOL_DESCRIPTIONS.map((tool) => (
                <SettingsSwitchRow
                  key={tool.id}
                  id={`command-tool-${tool.id}`}
                  title={tCommon(`tools.${tool.id}.label`)}
                  description={tCommon(`tools.${tool.id}.description`)}
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
              ))}
            </ItemGroup>
          </Card>
        </div>
      </div>
    </SettingsGroup>
  );
}
