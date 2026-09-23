import type { TFunction } from 'i18next';
import type { CommandDefinition, Parameter } from '../../../electron/agent/command-schema';

export type ContextVariable = 'input' | 'files' | 'selection' | 'clipboard';

export const contextVariables = [
  { name: 'input', detailKey: 'variables.inputDetail' },
  { name: 'files', detailKey: 'variables.filesDetail' },
  { name: 'selection', detailKey: 'variables.selectionDetail' },
  { name: 'clipboard', detailKey: 'variables.clipboardDetail' },
] as const satisfies readonly { name: ContextVariable; detailKey: string }[];

const typeTags = {
  text: 'parameters.type.tag.text',
  number: 'parameters.type.tag.number',
  enum: 'parameters.type.tag.enum',
  boolean: 'parameters.type.tag.boolean',
} as const;

export function parameterTypeTag(type: Parameter['type']) {
  return typeTags[type];
}

export function parameterVariables(
  command: Pick<CommandDefinition, 'parameters'>,
  t: TFunction<'commands'>,
) {
  return command.parameters.map((parameter) => {
    const type = t(parameterTypeTag(parameter.type));
    const values = { label: parameter.label, type };
    return {
      name: `argument.${parameter.key}`,
      detail:
        parameter.default === undefined
          ? t('variables.parameterDetail', values)
          : t('variables.parameterDetailDefault', { ...values, value: String(parameter.default) }),
    };
  });
}

export function variableDetails(
  command: Pick<CommandDefinition, 'parameters'>,
  t: TFunction<'commands'>,
) {
  return [
    ...contextVariables.map(({ name, detailKey }) => ({ name, detail: t(detailKey) })),
    ...parameterVariables(command, t),
  ];
}
