import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Button } from '@ai/ui/components/button';
import { Label } from '@ai/ui/components/label';
import { contextVariables, variableDetails, type ContextVariable } from './command-variables';
import { FieldHint } from '../../components/field-hint';
import type { CommandDefinition } from '../../client/agent/command-schema';
import type { AgentTask } from '../../client/agent/task-schema';
import { availableVariables } from '../../client/agent/command-validation';
import type { ComboboxAria } from '../composer-editor/editor-state';
import type { TriggerState } from '../quick-panel/trigger';
import type { QuickPanelHandle } from '../quick-panel/use-quick-panel';
import { instructionExtensions } from './instruction-extensions';
import { FieldError } from './field-error';
import { errorId } from './use-command-problems';
import { InstructionQuickPanel } from './instruction-quick-panel';
import { useInstructionEditor } from './use-instruction-editor';

export function InstructionEditor({
  command,
  onChange,
  onNormalize,
  onConfigureSource,
  readOnly,
  tasks,
  error,
  onBlur,
}: {
  command: CommandDefinition;
  onChange: Dispatch<SetStateAction<CommandDefinition>>;
  /** The instructions as loaded, without stray chip sentinels; not an edit of the draft. */
  onNormalize: (instructions: string) => void;
  onConfigureSource: (source: ContextVariable) => void;
  /** Shows the instructions without accepting edits (a plugin command). */
  readOnly: boolean;
  /** Snapshot tasks: `@` conversations and the titles of conversation chips. */
  tasks: readonly AgentTask[];
  /** The instructions' problem in the app's language, or '' when there is none. */
  error: string;
  /** Focus left the instructions, so the editor can check them again. */
  onBlur: () => void;
}) {
  const { t } = useTranslation('commands');
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [aria, setAria] = useState<ComboboxAria | null>(null);
  const panel = useRef<QuickPanelHandle>(null);
  const owner = useRef<HTMLDivElement | null>(null);
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
  // The editor reconfigures its variable support only when this value changes, so it depends on
  // the offered variables and the language, never on the typed text; a rebuilt completion source
  // would drop its open list.
  const { input, parameters } = command;
  const variables = useMemo(
    () => [
      instructionExtensions(
        { input, parameters },
        { variables: variableDetails({ parameters }, t), label: t('instruction.title') },
      ),
      readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
    ],
    [input, parameters, t, readOnly],
  );
  const changeInstructions = useCallback(
    (instructions: string) => onChange((current) => ({ ...current, instructions })),
    [onChange],
  );
  const editor = useInstructionEditor({
    instructions: command.instructions,
    onChange: changeInstructions,
    onNormalize,
    onTrigger: setTrigger,
    panel,
    tasks,
    variables,
    aria,
    errorId: error ? errorId('instructions') : null,
  });
  const { container } = editor;
  const host = useCallback(
    (node: HTMLDivElement | null) => {
      owner.current = node;
      const destroy = container(node);
      return () => {
        owner.current = null;
        destroy?.();
      };
    },
    [container],
  );
  const caret = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => editor.triggerRect(),
        get contextElement() {
          return owner.current ?? undefined;
        },
      },
    }),
    [editor],
  );
  return (
    <div className="settings-field" data-figma-node="1554:58480">
      <div className="instruction-toolbar">
        <div className="flex items-center gap-1.5">
          <Label>{t('instruction.title')}</Label>
          <FieldHint text={t('instruction.hint')} />
        </div>
      </div>
      <div ref={host} className="instruction-editor" onBlur={onBlur} />
      <InstructionQuickPanel
        trigger={trigger}
        editor={editor.commands}
        handleRef={panel}
        onAriaChange={setAria}
        tasks={tasks}
        anchor={caret}
        owner={owner}
      />
      {error && <FieldError id={errorId('instructions')}>{error}</FieldError>}
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
              onClick={() => editor.insertText(`{{${name}}}`)}
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
