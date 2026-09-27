import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { CommandSchema, type CommandDefinition } from '../../../electron/agent/command-schema';
import { renameArgument, validateCommand } from '../../../electron/agent/command-validation';
import { parse } from '../../../electron/agent/validation';
import type { SettingsSnapshot } from '../../../electron/settings-contract';
import type { AgentTask } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { agentApi } from '../agent/use-agent';
import { showErrorToast, showToast } from '../../components/toast-store';
import { messageOf } from '../../lib/errors';
import { InputOptions } from './input-options';
import { InstructionEditor } from './instruction-editor';
import { instructionProblem } from './instruction-problem';
import { ParameterEditor } from './parameter-editor';
import { RunSettings } from './run-settings';
import { parameterTypeTag } from './command-variables';
import { FieldHint } from '../../components/field-hint';
import { SettingsHeading } from '../settings/settings-heading';

export function CommandEditor({
  initial,
  expectedRevision,
  settings,
  tasks,
  onSaved,
  onCancel,
}: {
  initial: CommandDefinition;
  expectedRevision: number;
  settings: SettingsSnapshot | null;
  /** Snapshot tasks: the conversations instructions can mention. */
  tasks: readonly AgentTask[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('commands');
  const [draft, setDraft] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(expectedRevision);
  const [parameter, setParameter] = useState<{ index: number | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [inputOptionsOpen, setInputOptionsOpen] = useState(false);
  const errorMessage = useRef<HTMLDivElement>(null);
  const footerRef = useOverlayFooter<HTMLElement>();
  function showError(message: string) {
    setError(message);
    if (message)
      requestAnimationFrame(() => errorMessage.current?.scrollIntoView({ block: 'nearest' }));
  }
  /** Hands the work to a fresh panel session where the agent edits the command with its tools. */
  async function startSession() {
    const bridge = window.desktop?.settings;
    if (!bridge) return;
    const commandId = baseRevision ? draft.id : null;
    try {
      await bridge.startCommandSession(commandId);
      showToast({ kind: 'info', text: t('session.opened') });
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function save() {
    setError('');
    // Template problems first, in the app's language; the checks below name them in English.
    const problem = instructionProblem(draft, t);
    if (problem) {
      showError(problem);
      return;
    }
    try {
      validateCommand(draft);
      parse(CommandSchema, draft);
    } catch (error) {
      showError(messageOf(error));
      return;
    }
    setPending(true);
    try {
      await agentApi().saveCommand(draft, baseRevision);
      onSaved();
    } catch (error) {
      // A revision conflict has to stay inline: the reload control lives next to this error.
      showError(messageOf(error));
    }
    setPending(false);
  }
  async function reload() {
    try {
      const current = (await agentApi().get()).commands.find((command) => command.id === draft.id);
      if (!current) {
        showErrorToast(t('editor.deletedError'));
        return;
      }
      setDraft(current);
      setBaseRevision(current.revision);
      setError('');
    } catch (error) {
      showErrorToast(error);
    }
  }
  function move(index: number, offset: number) {
    const parameters = [...draft.parameters];
    const item = parameters.splice(index, 1)[0]!;
    parameters.splice(index + offset, 0, item);
    setDraft({ ...draft, parameters });
  }
  if (parameter)
    return (
      <ParameterEditor
        initial={parameter.index === null ? null : draft.parameters[parameter.index]!}
        commandName={draft.name}
        keys={draft.parameters
          .filter((_, index) => index !== parameter.index)
          .map((item) => item.key)}
        onCancel={() => setParameter(null)}
        onSave={(value) => {
          const parameters = [...draft.parameters];
          const previousKey = parameter.index === null ? null : parameters[parameter.index]!.key;
          if (parameter.index === null) parameters.push(value);
          else parameters[parameter.index] = value;
          setDraft({
            ...draft,
            parameters,
            instructions:
              previousKey && previousKey !== value.key
                ? renameArgument(draft.instructions, previousKey, value.key)
                : draft.instructions,
          });
          setParameter(null);
        }}
      />
    );
  return (
    <section className="command-editor" aria-label={t('editor.label')} data-figma-node="348:799">
      <SettingsHeading
        title={baseRevision ? t('editor.editTitle') : t('editor.newTitle')}
        onBack={onCancel}
        backLabel={t('editor.back')}
      />
      <ScrollArea
        className="flex-1 min-h-0 min-w-0 m-[-3px_-15px_-3px_-3px]"
        viewportClassName="overlay-footer-fade"
        gutter
      >
        <div className="editor-fields p-0.75">
          <div className="field-columns aligned-fields">
            <div className="settings-field">
              <Label htmlFor="command-name">{t('editor.name')}</Label>
              <Input
                id="command-name"
                value={draft.name}
                maxLength={120}
                placeholder={t('editor.namePlaceholder')}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="command-description">{t('editor.description')}</Label>
              <Input
                id="command-description"
                value={draft.description}
                maxLength={500}
                placeholder={t('editor.descriptionPlaceholder')}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
          </div>
          <InstructionEditor
            command={draft}
            onChange={setDraft}
            tasks={tasks}
            onConfigureSource={(source) => {
              setInputOptionsOpen(true);
              requestAnimationFrame(() => {
                const control = document.getElementById(
                  source === 'input' ? 'command-source' : `input-${source}`,
                );
                control?.scrollIntoView({ block: 'nearest' });
                control?.focus();
              });
            }}
          />
          <InputOptions
            command={draft}
            onChange={setDraft}
            open={inputOptionsOpen}
            onOpenChange={setInputOptionsOpen}
          />
          <section className="settings-field">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Label>{t('editor.parameters')}</Label>
                <FieldHint text={t('editor.parametersHint')} />
              </div>
              <Button
                variant="outline"
                disabled={draft.parameters.length >= 20}
                onClick={() => setParameter({ index: null })}
              >
                <Plus />
                {t('parameters.add')}
              </Button>
            </div>
            <ul className="parameter-items">
              {draft.parameters.map((item, index) => {
                const type = t(parameterTypeTag(item.type));
                const required = item.required ? ` · ${t('parameters.required')}` : '';
                return (
                  <li key={item.key} className="parameter-item hover:bg-muted/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={item.label}>
                        {item.label}
                      </p>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={`{{argument.${item.key}}} · ${type}${required}`}
                      >
                        <span className="variable-token">{`{{argument.${item.key}}}`}</span> ·{' '}
                        {type}
                        {required}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        label={t('editor.moveUp')}
                        aria-label={t('editor.moveUpFor', { name: item.label })}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ChevronUp />
                      </IconButton>
                      <IconButton
                        label={t('editor.moveDown')}
                        aria-label={t('editor.moveDownFor', { name: item.label })}
                        disabled={index === draft.parameters.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ChevronDown />
                      </IconButton>
                      <IconButton
                        label={t('common.edit')}
                        aria-label={t('editor.editFor', { name: item.label })}
                        onClick={() => setParameter({ index })}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={t('common.remove')}
                        aria-label={t('editor.removeFor', { name: item.label })}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            parameters: draft.parameters.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <RunSettings command={draft} onChange={setDraft} settings={settings} />
          {error && (
            <div ref={errorMessage} role="alert" className="space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              {baseRevision > 0 && (
                <Button variant="outline" onClick={() => void reload()}>
                  {t('editor.reload')}
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        <Button
          type="button"
          variant="outline"
          disabled={pending || !window.desktop?.settings}
          onClick={() => void startSession()}
        >
          <Sparkles data-icon="inline-start" />
          {baseRevision ? t('session.triggerEdit') : t('session.trigger')}
        </Button>
        <div>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={pending} onClick={() => void save()}>
            {pending
              ? t('editor.saving')
              : baseRevision
                ? t('editor.saveChanges')
                : t('editor.create')}
          </Button>
        </div>
      </footer>
    </section>
  );
}
