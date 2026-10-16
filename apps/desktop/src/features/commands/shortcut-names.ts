import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  commandShortcut,
  hasOverrides,
  type CommandModel,
  type CommandShortcut,
  type CommandThinkingLevel,
  type ShortcutHolder,
} from '@atd/agent-contracts';
import type { CommandDefinition, Parameter } from '../../client/agent/command-schema';

/** The longest generated name, the same cap as a name the person types. */
const MAX_NAME = 120;
const SEPARATOR = ' · ';

type Commands = TFunction<'commands'>;
type Providers = TFunction<'providers'>;

/** An argument value as the command's form shows it: an option's label, On or Off, the text. */
export function argumentText(
  parameter: Parameter,
  value: string | number | boolean,
  t: Commands,
): string {
  if (parameter.type === 'enum')
    return parameter.options.find((option) => option.value === value)?.label ?? String(value);
  if (parameter.type === 'boolean')
    return t(value === true ? 'shortcut.name.on' : 'shortcut.name.off');
  return String(value);
}

/** A command model as the editor names it: the fixed model's id, or the app's default. */
export function modelText(model: CommandModel, t: Commands): string {
  return model.mode === 'fixed' ? model.modelId : t('shortcut.name.appDefaultModel');
}

/** A reasoning level as the editor's effort field names it. */
export function thinkingText(level: CommandThinkingLevel, t: Commands, tProviders: Providers) {
  return level === 'inherit'
    ? t('run.thinkingLevelInherit')
    : tProviders(`thinkingLevels.levels.${level}`);
}

/**
 * A name for a shortcut the person did not name, made from what it overrides in the editor's
 * order: each pinned value (an option's label, a switch that is on by its label, anything else
 * as "label: value"), then the result, the model and the effort. Page-only and localized; the
 * shell names a shortcut by the command and the person's own name (`I2`), never by this.
 */
function generatedName(
  command: CommandDefinition,
  shortcut: CommandShortcut,
  t: Commands,
  tProviders: Providers,
): string {
  if (!hasOverrides(shortcut)) return t('shortcut.name.usesCommand');
  const parts: string[] = [];
  for (const parameter of command.parameters) {
    const value = shortcut.arguments[parameter.key];
    if (value === undefined) continue;
    if (parameter.type === 'enum') parts.push(argumentText(parameter, value, t));
    else if (parameter.type === 'boolean' && value === true) parts.push(parameter.label);
    else
      parts.push(
        t('shortcut.name.value', {
          label: parameter.label,
          value: argumentText(parameter, value, t),
        }),
      );
  }
  if (shortcut.output) parts.push(t(`output.${shortcut.output.action}.title`));
  if (shortcut.model) parts.push(modelText(shortcut.model, t));
  if (shortcut.thinkingLevel)
    parts.push(
      t('shortcut.name.value', {
        label: t('run.thinkingLevel'),
        value: thinkingText(shortcut.thinkingLevel, t, tProviders),
      }),
    );
  // Pins of parameters the command no longer has name nothing; the editor flags them instead.
  if (!parts.length) return t('shortcut.name.usesCommand');
  const name = parts.join(SEPARATOR);
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

/** The editor's names for a command's shortcuts, in the app's language. */
export function useShortcutNames() {
  const { t } = useTranslation('commands');
  const { t: tProviders } = useTranslation('providers');
  /** The name the person gave the shortcut, else one made from its overrides. */
  const title = (command: CommandDefinition, shortcut: CommandShortcut) =>
    shortcut.name || generatedName(command, shortcut, t, tProviders);
  return {
    title,
    /** The name made from the shortcut's overrides, which its name field offers as a hint. */
    generated: (command: CommandDefinition, shortcut: CommandShortcut) =>
      generatedName(command, shortcut, t, tProviders),
    /**
     * A command shortcut that holds some keys, for conflict messages: the command's name, with
     * the shortcut's own when it has one or the command has more than one to tell apart.
     */
    holder: (
      holder: Extract<ShortcutHolder, { kind: 'command' }>,
      commands: readonly CommandDefinition[],
    ): string => {
      const command = commands.find((item) => item.id === holder.id);
      const shortcut = command && commandShortcut(command, holder.shortcutId);
      if (!command || !shortcut || (!shortcut.name && command.shortcuts.length < 2))
        return holder.name;
      return `${holder.name}${SEPARATOR}${title(command, shortcut)}`;
    },
  };
}

export type ShortcutNames = ReturnType<typeof useShortcutNames>;
