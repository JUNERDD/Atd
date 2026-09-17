import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { instructionExtensions } from './instruction-extensions';
import { instructionTheme } from './instruction-theme';
import { Plus, Settings2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Label } from '@ai/ui/components/label';
import { contextVariables, variableDetails, type ContextVariable } from './command-variables';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { availableVariables, templateReferences } from '../../../electron/agent/command-validation';

export function InstructionEditor({
  command,
  onChange,
  onAddParameter,
  onConfigureSource,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
  onAddParameter: () => void;
  onConfigureSource: (source: ContextVariable) => void;
}) {
  const { t } = useTranslation('commands');
  const editor = useRef<ReactCodeMirrorRef>(null);
  const available = availableVariables(command);
  // Disabled context sources stay listed so their configure entry remains reachable.
  const chips = [
    ...contextVariables.map(({ name }) => ({
      name,
      enabled: available.includes(name),
      source: name,
    })),
    ...available
      .filter((name) => !contextVariables.some((variable) => variable.name === name))
      .map((name) => ({ name, enabled: true, source: undefined })),
  ];
  const extensions = instructionExtensions(command, {
    variables: variableDetails(command, t),
    label: t('instruction.title'),
  });
  function insert(name: string) {
    const view = editor.current?.view;
    const value = `{{${name}}}`;
    const selection = view?.state.selection.main;
    const from = selection?.from ?? command.instructions.length;
    const to = selection?.to ?? from;
    onChange({
      ...command,
      instructions: `${command.instructions.slice(0, from)}${value}${command.instructions.slice(to)}`,
    });
    requestAnimationFrame(() => {
      const current = editor.current?.view;
      if (current) {
        current.dispatch({
          selection: { anchor: Math.min(from + value.length, current.state.doc.length) },
        });
        current.focus();
      }
    });
  }
  let referenceError = '';
  try {
    const unknown = templateReferences(command.instructions).filter(
      (ref) => !available.includes(ref.name),
    );
    if (unknown.length)
      referenceError = t('instruction.referenceError', {
        variables: unknown.map((ref) => `{{${ref.name}}}`).join(', '),
      });
  } catch (error) {
    referenceError = error instanceof Error ? error.message : t('instruction.syntaxError');
  }
  return (
    <div className="settings-field" data-figma-node="417:1716">
      <div className="instruction-toolbar">
        <Label>{t('instruction.title')}</Label>
      </div>
      <CodeMirror
        ref={editor}
        value={command.instructions}
        minHeight="96px"
        theme={instructionTheme}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          bracketMatching: false,
          closeBrackets: false,
        }}
        extensions={extensions}
        onChange={(instructions) => onChange({ ...command, instructions })}
        className="instruction-editor"
      />
      {referenceError && (
        <p role="alert" className="text-xs text-destructive">
          {referenceError}
        </p>
      )}
      <div className="variable-chips" aria-label={t('instruction.available')}>
        {chips.map(({ name, enabled, source }) =>
          enabled || !source ? (
            <Button
              key={name}
              type="button"
              variant="outline"
              size="sm"
              className="variable-token font-normal"
              title={`{{${name}}}`}
              onClick={() => insert(name)}
            >
              <span className="truncate">{`{{${name}}}`}</span>
            </Button>
          ) : (
            <Button
              key={name}
              type="button"
              variant="outline"
              size="sm"
              className="font-normal text-muted-foreground"
              title={t('variables.configureFor', { name: `{{${name}}}` })}
              aria-label={t('variables.configureFor', { name: `{{${name}}}` })}
              onClick={() => onConfigureSource(source)}
            >
              <Settings2 />
              <span className="truncate">{`{{${name}}}`}</span>
            </Button>
          ),
        )}
        <Button type="button" variant="outline" size="sm" onClick={onAddParameter}>
          <Plus />
          {t('parameters.add')}
        </Button>
      </div>
      <p className="truncate text-xs text-muted-foreground" title={t('instruction.hint')}>
        {t('instruction.hint')}
      </p>
    </div>
  );
}
