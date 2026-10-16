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
import { SettingsGroup } from '../settings/settings-group';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { TOOL_DESCRIPTIONS, type CommandDefinition } from '../../client/agent/command-schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { ModelField, ThinkingLevelField } from './run-fields';

/**
 * The command's run policy as an editor group: model, effort, memory and allowed tools. The effort
 * is the command's own, whichever model runs it, so the fixed model's popover offers none.
 */
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
  return (
    <SettingsGroup id="command-run" title={t('run.title')} description={t('run.description')}>
      <div className="run-settings">
        <div className="field-columns aligned-fields">
          <ModelField
            id="command-model-policy"
            value={command.model}
            settings={settings}
            onChange={(model) => {
              if (model) onChange({ ...command, model });
            }}
          />
          <ThinkingLevelField
            id="command-thinking-level"
            value={command.thinkingLevel}
            onChange={(thinkingLevel) => {
              if (thinkingLevel) onChange({ ...command, thinkingLevel });
            }}
          />
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
