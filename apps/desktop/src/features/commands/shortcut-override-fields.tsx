import { useTranslation } from 'react-i18next';
import { writesBack, type CommandShortcut } from '@atd/agent-contracts';
import { Card } from '@atd/ui/components/card';
import { Input } from '@atd/ui/components/input';
import { ItemGroup } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { CommandDefinition, Parameter } from '../../client/agent/command-schema';
import { parameterError } from '../../client/agent/command-validation';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { FOLLOW, FollowItem } from './follow-item';
import { OutputField } from './output-field';
import { ModelField, ThinkingLevelField } from './run-fields';
import { argumentText, modelText, thinkingText } from './shortcut-names';

type Value = string | number | boolean;

/**
 * The value a run from a shortcut that pins nothing for `parameter` starts from: the command's
 * remembered value while the parameter still takes it, else the parameter's default.
 */
function commandValue(command: CommandDefinition, parameter: Parameter): Value | undefined {
  const remembered = command.lastArguments?.[parameter.key];
  return remembered !== undefined && !parameterError(parameter, remembered)
    ? remembered
    : parameter.default;
}

/**
 * One parameter's pinned value: a choice or a switch as a Select whose first item follows the
 * command (naming what it uses now), text or a number as a field left empty to follow, with what
 * the command uses now as its placeholder. `onChange(undefined)` unpins it.
 */
function PinnedField({
  parameter,
  value,
  current,
  onChange,
}: {
  parameter: Parameter;
  value: Value | undefined;
  current: Value | undefined;
  onChange: (value: Value | undefined) => void;
}) {
  const { t } = useTranslation('commands');
  const id = `shortcut-argument-${parameter.key}`;
  const now = current === undefined ? undefined : argumentText(parameter, current, t);
  const follow =
    now === undefined ? t('shortcut.followPlain') : t('shortcut.follow', { value: now });
  const error = value === undefined ? '' : parameterError(parameter, value);
  const label = (
    <Label htmlFor={id} className="min-w-0">
      <span className="truncate" title={parameter.label}>
        {parameter.label}
      </span>
    </Label>
  );
  let control;
  if (parameter.type === 'enum' || parameter.type === 'boolean') {
    const options =
      parameter.type === 'enum'
        ? parameter.options.filter((option) => option.value.trim())
        : [
            { value: 'true', label: t('shortcut.name.on') },
            { value: 'false', label: t('shortcut.name.off') },
          ];
    control = (
      <Select
        value={value === undefined ? FOLLOW : String(value)}
        onValueChange={(next) => {
          if (next === FOLLOW) onChange(undefined);
          else onChange(parameter.type === 'boolean' ? next === 'true' : next);
        }}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error) || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <FollowItem label={follow} />
          {options.map((option, index) => (
            <SelectItem key={`${index}:${option.value}`} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else {
    const number = parameter.type === 'number';
    control = (
      <Input
        id={id}
        type={number ? 'number' : 'text'}
        step={number ? 'any' : undefined}
        min={number ? parameter.min : undefined}
        max={number ? parameter.max : undefined}
        maxLength={number ? undefined : parameter.maxLength}
        value={value === undefined ? '' : String(value)}
        placeholder={now ?? t('shortcut.followPlain')}
        aria-invalid={Boolean(error) || undefined}
        onChange={(event) => {
          const text = event.target.value;
          if (!text) onChange(undefined);
          else onChange(number ? event.target.valueAsNumber : text);
        }}
      />
    );
  }
  return (
    <div className="settings-field parameter-field">
      {label}
      {control}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What a run from one shortcut does differently from the command: a pinned value per parameter,
 * the result (with the review switch of a write-back), the model and the effort. Each field's
 * first choice follows the command, which leaves the override out of the shortcut.
 */
export function ShortcutOverrideFields({
  command,
  shortcut,
  onChange,
  settings,
}: {
  command: CommandDefinition;
  shortcut: CommandShortcut;
  onChange: (shortcut: CommandShortcut) => void;
  settings: SettingsSnapshot | null;
}) {
  const { t } = useTranslation('commands');
  const { t: tProviders } = useTranslation('providers');
  const follow = (value: string) => t('shortcut.follow', { value });
  function pin(key: string, value: Value | undefined) {
    const { [key]: _previous, ...rest } = shortcut.arguments;
    onChange({ ...shortcut, arguments: value === undefined ? rest : { ...rest, [key]: value } });
  }
  /** The shortcut with `field` overridden by `value`, or following the command when undefined. */
  function override<K extends 'output' | 'model' | 'thinkingLevel'>(
    field: K,
    value: CommandShortcut[K],
  ) {
    const next: CommandShortcut = { ...shortcut };
    if (value === undefined) delete next[field];
    else next[field] = value;
    onChange(next);
  }
  return (
    <div className="editor-fields">
      {command.parameters.map((parameter) => (
        <PinnedField
          key={parameter.key}
          parameter={parameter}
          value={shortcut.arguments[parameter.key]}
          current={commandValue(command, parameter)}
          onChange={(value) => pin(parameter.key, value)}
        />
      ))}
      <OutputField
        id="shortcut-result"
        input={command.input}
        value={shortcut.output?.action}
        follow={follow(t(`output.${command.output.action}.title`))}
        onChange={(action) =>
          override(
            'output',
            action && { action, review: shortcut.output?.review ?? command.output.review },
          )
        }
      />
      {shortcut.output && writesBack(shortcut.output.action) && (
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <SettingsSwitchRow
              id="shortcut-output-review"
              title={t('output.review.title')}
              description={t('output.review.description')}
              checked={shortcut.output.review}
              onCheckedChange={(review) =>
                shortcut.output && override('output', { ...shortcut.output, review })
              }
            />
          </ItemGroup>
        </Card>
      )}
      <div className="field-columns aligned-fields">
        <ModelField
          id="shortcut-model"
          value={shortcut.model}
          settings={settings}
          follow={follow(modelText(command.model, t))}
          onChange={(model) => override('model', model)}
        />
        <ThinkingLevelField
          id="shortcut-thinking-level"
          value={shortcut.thinkingLevel}
          follow={follow(thinkingText(command.thinkingLevel, t, tProviders))}
          onChange={(level) => override('thinkingLevel', level)}
        />
      </div>
    </div>
  );
}
