import { useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import CodeMirror, { type BasicSetupOptions, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { instructionExtensions } from './instruction-extensions';
import { instructionTheme } from './instruction-theme';
import { Settings2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Label } from '@ai/ui/components/label';
import { contextVariables, variableDetails, type ContextVariable } from './command-variables';
import { FieldHint } from '../../components/field-hint';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { availableVariables } from '../../../electron/agent/command-validation';
import { instructionProblem } from './instruction-problem';

const basicSetup: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  autocompletion: false,
  bracketMatching: false,
  closeBrackets: false,
};

export function InstructionEditor({
  command,
  onChange,
  onConfigureSource,
}: {
  command: CommandDefinition;
  onChange: Dispatch<SetStateAction<CommandDefinition>>;
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
  // react-codemirror reconfigures the editor whenever `basicSetup`, `extensions` or `onChange`
  // changes identity; rebuilt extensions also replace the completion source, which drops its open
  // list. So typing changes none of them: the extensions change only with the offered variables
  // and the language.
  const { input, parameters } = command;
  const extensions = useMemo(
    () =>
      instructionExtensions(
        { input, parameters },
        { variables: variableDetails({ parameters }, t), label: t('instruction.title') },
      ),
    [input, parameters, t],
  );
  const changeInstructions = useCallback(
    (instructions: string) => onChange((current) => ({ ...current, instructions })),
    [onChange],
  );
  function insert(name: string) {
    const value = `{{${name}}}`;
    const view = editor.current?.view;
    if (!view) {
      onChange((current) => ({ ...current, instructions: `${current.instructions}${value}` }));
      return;
    }
    // Edit the editor's own document; its change reaches the draft through `onChange`. Setting the
    // draft instead races with typing: react-codemirror holds back a new `value` while the user
    // types, then applies it over whatever was typed in the meantime.
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: value },
      selection: { anchor: from + value.length },
      scrollIntoView: true,
      userEvent: 'input.complete',
    });
    view.focus();
  }
  const referenceError = instructionProblem(command, t);
  return (
    <div className="settings-field" data-figma-node="417:1716">
      <div className="instruction-toolbar">
        <div className="flex items-center gap-1.5">
          <Label>{t('instruction.title')}</Label>
          <FieldHint text={t('instruction.hint')} />
        </div>
      </div>
      <CodeMirror
        ref={editor}
        value={command.instructions}
        minHeight="96px"
        theme={instructionTheme}
        basicSetup={basicSetup}
        extensions={extensions}
        onChange={changeInstructions}
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
      </div>
    </div>
  );
}
