import { useTranslation } from 'react-i18next';
import { Value } from 'typebox/value';
import {
  CommandThinkingLevelSchema,
  ThinkingLevelSchema,
  type CommandModel,
  type CommandThinkingLevel,
} from '@atd/agent-contracts';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { FieldHint } from '../../components/field-hint';
import { ModelConfigPopover } from '../providers/model-config-popover';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { FOLLOW, FollowItem } from './follow-item';

/** Every level a command may ask for, lowest first, after `inherit`. */
const LEVELS = ThinkingLevelSchema.anyOf.map((level) => level.const);

/**
 * The model a run uses, as a labelled Select: the app's default or a fixed model, chosen in the
 * model popover beside it. The command's effort is its own, so the popover offers none. With
 * `follow`, the first item (labelled by it) leaves the choice to the command and reports
 * `undefined`, as a shortcut that does not override the model.
 */
export function ModelField({
  id,
  value,
  onChange,
  settings,
  follow,
}: {
  id: string;
  value: CommandModel | undefined;
  onChange: (model: CommandModel | undefined) => void;
  settings: SettingsSnapshot | null;
  follow?: string;
}) {
  const { t } = useTranslation('commands');
  const provider = settings?.connections.find(
    (connection) => connection.connectionId === settings.defaultConnectionId,
  );
  const fixedModel = value?.mode === 'fixed' ? value : null;
  return (
    <div className="settings-field">
      <Label htmlFor={id}>{t('run.model')}</Label>
      <div className="settings-field">
        <Select
          value={value?.mode ?? FOLLOW}
          onValueChange={(mode) => {
            if (mode === FOLLOW) onChange(undefined);
            else if (mode === 'inherit') onChange({ mode: 'inherit' });
            else
              onChange({
                mode: 'fixed',
                connectionId: provider?.connectionId ?? '',
                modelId: provider?.defaultModel ?? '',
              });
          }}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <FollowItem label={follow} />
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
            hideEffort
            onModelChange={(reference) => onChange({ ...fixedModel, ...reference })}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The reasoning level a run asks for, whichever model runs it, as a labelled Select: the
 * connection's default or a level. With `follow`, the first item (labelled by it) leaves the
 * level to the command and reports `undefined`.
 */
export function ThinkingLevelField({
  id,
  value,
  onChange,
  follow,
}: {
  id: string;
  value: CommandThinkingLevel | undefined;
  onChange: (level: CommandThinkingLevel | undefined) => void;
  follow?: string;
}) {
  const { t } = useTranslation('commands');
  const { t: tProviders } = useTranslation('providers');
  return (
    <div className="settings-field">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{t('run.thinkingLevel')}</Label>
        <FieldHint text={t('run.thinkingLevelHint')} />
      </div>
      <Select
        value={value ?? FOLLOW}
        onValueChange={(level) => {
          if (level === FOLLOW) onChange(undefined);
          else if (Value.Check(CommandThinkingLevelSchema, level)) onChange(level);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <FollowItem label={follow} />
          <SelectItem value="inherit">{t('run.thinkingLevelInherit')}</SelectItem>
          {LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {tProviders(`thinkingLevels.levels.${level}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
