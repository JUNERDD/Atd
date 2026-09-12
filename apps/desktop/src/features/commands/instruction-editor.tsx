import { useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { instructionExtensions } from './instruction-extensions';
import { instructionTheme } from './instruction-theme';
import { Braces } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Label } from '@ai/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@ai/ui/components/popover';
import { VariablePicker } from './variable-picker';
import type { ContextVariable } from './command-variables';
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
  const editor = useRef<ReactCodeMirrorRef>(null);
  const [open, setOpen] = useState(false);
  const available = availableVariables(command);
  const extensions = instructionExtensions(command);
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
      referenceError = `Enable or define ${unknown.map((ref) => `{{${ref.name}}}`).join(', ')}.`;
  } catch (error) {
    referenceError = error instanceof Error ? error.message : 'Check the variable syntax.';
  }
  return (
    <div className="settings-field" data-figma-node="417:1716">
      <div className="flex items-center justify-between gap-2">
        <Label>Instructions</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <Braces />
              Insert variable
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="variable-picker p-0 rounded-2xl bg-popover"
            align="end"
            collisionPadding={8}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <VariablePicker
              command={command}
              onInsert={insert}
              onDone={() => setOpen(false)}
              onConfigure={(source) => {
                setOpen(false);
                onConfigureSource(source);
              }}
              onAddParameter={() => {
                setOpen(false);
                onAddParameter();
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      <CodeMirror
        ref={editor}
        value={command.instructions}
        height="112px"
        theme={instructionTheme}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          bracketMatching: false,
        }}
        extensions={extensions}
        onChange={(instructions) => onChange({ ...command, instructions })}
        className="instruction-editor"
      />
      {referenceError && (
        <p role="alert" className="text-xs text-destructive">
          {referenceError}{' '}
          <Button variant="link" size="xs" onClick={() => setOpen(true)}>
            Find a variable
          </Button>
        </p>
      )}
      <div className="variable-chips" aria-label="Available variables">
        {available.map((name) => (
          <Button
            key={name}
            type="button"
            variant="outline"
            size="sm"
            className="variable-token font-normal"
            onClick={() => insert(name)}
          >{`{{${name}}}`}</Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Use variables for task input. Type {'{{'} to see suggestions.
      </p>
    </div>
  );
}
