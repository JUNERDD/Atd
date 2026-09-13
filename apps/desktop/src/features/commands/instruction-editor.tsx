import { useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { instructionExtensions } from './instruction-extensions';
import { instructionTheme } from './instruction-theme';
import { Braces, Undo2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Label } from '@ai/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@ai/ui/components/popover';
import { VariablePicker } from './variable-picker';
import { InstructionGenerator } from './instruction-generator';
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
  const preserveTargetFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
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
      referenceError = `Enable or define ${unknown.map((ref) => `{{${ref.name}}}`).join(', ')}.`;
  } catch (error) {
    referenceError = error instanceof Error ? error.message : 'Check the variable syntax.';
  }
  return (
    <div className="settings-field" data-figma-node="417:1716">
      <div className="instruction-toolbar">
        <Label>Instructions</Label>
        <div className="instruction-actions">
          <InstructionGenerator
            command={command}
            onChange={(next) => {
              setUndo(command.instructions);
              onChange(next);
            }}
          />
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
                Insert variable
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
      {undo !== null && (
        <div className="generation-feedback">
          <output>Generated instructions applied to this draft.</output>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              onChange({ ...command, instructions: undo });
              setUndo(null);
            }}
          >
            <Undo2 />
            Undo
          </Button>
        </div>
      )}
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
            title={`{{${name}}}`}
            onClick={() => insert(name)}
          >
            <span className="truncate">{`{{${name}}}`}</span>
          </Button>
        ))}
      </div>
      <p
        className="truncate text-xs text-muted-foreground"
        title="Use variables for task input. Type {{ to see suggestions."
      >
        Use variables for task input. Type {'{{'} to see suggestions.
      </p>
    </div>
  );
}
