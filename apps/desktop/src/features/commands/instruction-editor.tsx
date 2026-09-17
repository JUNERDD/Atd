import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { instructionExtensions } from './instruction-extensions';
import { instructionTheme } from './instruction-theme';
import { Braces } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Label } from '@ai/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@ai/ui/components/popover';
import { VariablePicker } from './variable-picker';
import { variableDetails, type ContextVariable } from './command-variables';
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
  const preserveTargetFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const available = availableVariables(command);
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
    preserveTargetFocus.current = true;
    setOpen(false);
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
        <div className="instruction-actions">
          <Popover
            open={open}
            onOpenChange={(value) => {
              if (value) preserveTargetFocus.current = false;
              setOpen(value);
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="xs">
                <Braces data-icon="inline-start" />
                {t('variables.insert')}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="variable-picker p-0 rounded-2xl bg-popover"
              align="end"
              collisionPadding={8}
              onCloseAutoFocus={(event) => {
                if (preserveTargetFocus.current) event.preventDefault();
              }}
            >
              <VariablePicker
                command={command}
                onInsert={insert}
                onDone={() => setOpen(false)}
                onConfigure={(source) => {
                  preserveTargetFocus.current = true;
                  setOpen(false);
                  onConfigureSource(source);
                }}
                onAddParameter={() => {
                  preserveTargetFocus.current = true;
                  setOpen(false);
                  onAddParameter();
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
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
          {referenceError}{' '}
          <Button
            variant="link"
            size="xs"
            onClick={() => {
              preserveTargetFocus.current = false;
              setOpen(true);
            }}
          >
            {t('instruction.find')}
          </Button>
        </p>
      )}
      <div className="variable-chips" aria-label={t('instruction.available')}>
        {available.map((name) => (
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
        ))}
      </div>
      <p className="truncate text-xs text-muted-foreground" title={t('instruction.hint')}>
        {t('instruction.hint')}
      </p>
    </div>
  );
}
