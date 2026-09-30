import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Puzzle, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@ai/ui/components/alert';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { CommandSchema, type CommandDefinition } from '../../client/agent/command-schema';
import { renameArgument, validateCommand } from '../../client/agent/command-validation';
import { parse } from '../../client/agent/validation';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { AgentTask } from '../../client/agent/task-schema';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { agentApi } from '../agent/use-agent';
import { showErrorToast, showToast } from '../../components/toast-store';
import { messageOf } from '../../lib/errors';
import { InputOptions } from './input-options';
import { InstructionEditor } from './instruction-editor';
import { instructionProblem } from './instruction-problem';
import { ParameterEditor } from './parameter-editor';
import { ParameterList } from './parameter-list';
import { RunSettings } from './run-settings';
import { SettingsHeading } from '../settings/settings-heading';

/** A parameter's page over the command editor, a page of the Commands section's history. */
export interface ParameterPage {
  /** The page shown: the parameter's key, or null for a new parameter; null shows the editor. */
  shown: { key: string | null } | null;
  open: (key: string | null) => void;
  /** Leaves the page; after a save, `saved` is the key Forward then reopens. */
  close: (saved?: string) => void;
  /** Leaves a page whose parameter the draft no longer has, as after Back discarded the draft. */
  discard: () => void;
}

export function CommandEditor({
  initial,
  expectedRevision,
  settings,
  tasks,
  parameterPage,
  onSaved,
  onCancel,
  onDuplicate,
}: {
  initial: CommandDefinition;
  expectedRevision: number;
  settings: SettingsSnapshot | null;
  /** Snapshot tasks: the conversations instructions can mention. */
  tasks: readonly AgentTask[];
  parameterPage: ParameterPage;
  onSaved: () => void;
  onCancel: () => void;
  /** Duplicate to Personal, offered in place of saving when `initial` belongs to a plugin. */
  onDuplicate: () => void;
}) {
  const { t } = useTranslation('commands');
  // A plugin command is shown, never edited: the fieldset below disables every control.
  const plugin = initial.pluginId;
  const [draft, setDraft] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(expectedRevision);
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
  const { shown, discard } = parameterPage;
  const index =
    shown && shown.key !== null
      ? draft.parameters.findIndex((item) => item.key === shown.key)
      : null;
  const missing = index === -1;
  useEffect(() => {
    if (missing) discard();
  }, [missing, discard]);
  if (shown && !missing)
    return (
      <ParameterEditor
        initial={index === null ? null : draft.parameters[index]!}
        commandName={draft.name}
        keys={draft.parameters.filter((_, i) => i !== index).map((item) => item.key)}
        onCancel={() => parameterPage.close()}
        onSave={(value) => {
          const parameters = [...draft.parameters];
          const previousKey = index === null ? null : parameters[index]!.key;
          if (index === null) parameters.push(value);
          else parameters[index] = value;
          setDraft({
            ...draft,
            parameters,
            instructions:
              previousKey && previousKey !== value.key
                ? renameArgument(draft.instructions, previousKey, value.key)
                : draft.instructions,
          });
          parameterPage.close(value.key);
        }}
      />
    );
  return (
    <section className="command-editor" aria-label={t('editor.label')} data-figma-node="348:799">
      <SettingsHeading
        title={
          plugin
            ? t('editor.viewTitle')
            : baseRevision
              ? t('editor.editTitle')
              : t('editor.newTitle')
        }
        subpage
        backLabel={t('editor.back')}
      />
      <ScrollArea
        className="flex-1 min-h-0 min-w-0 m-[-3px_-15px_-3px_-3px]"
        viewportClassName="overlay-footer-fade"
        gutter="stable"
      >
        <fieldset disabled={Boolean(plugin)} className="editor-fields min-w-0 p-0.75">
          {plugin && (
            <Alert role="note">
              <Puzzle />
              <AlertDescription>{t('editor.pluginNotice', { plugin })}</AlertDescription>
            </Alert>
          )}
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
            readOnly={Boolean(plugin)}
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
          <ParameterList
            parameters={draft.parameters}
            onChange={(parameters) => setDraft({ ...draft, parameters })}
            onOpen={parameterPage.open}
          />
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
        </fieldset>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        {plugin ? (
          <div>
            <Button variant="glass" onClick={onDuplicate}>
              <Copy data-icon="inline-start" />
              {t('list.duplicateToPersonal')}
            </Button>
          </div>
        ) : (
          <>
            <Button
              type="button"
              variant="glass"
              disabled={pending || !window.desktop?.settings}
              onClick={() => void startSession()}
            >
              <Sparkles data-icon="inline-start" />
              {baseRevision ? t('session.triggerEdit') : t('session.trigger')}
            </Button>
            <div>
              <Button variant="glass" disabled={pending} onClick={onCancel}>
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
          </>
        )}
      </footer>
    </section>
  );
}
