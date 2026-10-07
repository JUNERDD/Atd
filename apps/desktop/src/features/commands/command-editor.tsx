import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Copy, Puzzle, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@atd/ui/components/alert';
import { Button } from '@atd/ui/components/button';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { CommandSchema, type CommandDefinition } from '../../client/agent/command-schema';
import { renameArgument } from '../../client/agent/command-validation';
import { parse } from '../../client/agent/validation';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { AgentTask } from '../../client/agent/task-schema';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { agentApi } from '../agent/use-agent';
import { showErrorToast } from '../../components/toast-store';
import { messageOf } from '../../lib/errors';
import { InputOptions } from './input-options';
import { InstructionEditor } from './instruction-editor';
import { FieldError } from './field-error';
import { ParameterEditor } from './parameter-editor';
import { ParameterList } from './parameter-list';
import { PlacementSettings } from './placement-settings';
import { RunSettings } from './run-settings';
import { useCommandAiSession } from './use-command-ai-session';
import { errorId, useCommandProblems } from './use-command-problems';
import { SettingsGroup } from '../settings/settings-group';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsUnsavedChanges } from '../settings/settings-unsaved-changes';

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

/** A command as the unsaved-changes check compares it: allowed tools are a set, not a list. */
function comparable(command: CommandDefinition): string {
  return JSON.stringify({ ...command, tools: command.tools.toSorted() });
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
  // What the draft started from: the opened command, or the latest version after a reload.
  const [baseline, setBaseline] = useState(initial);
  // Commands are plain data, so their JSON tells an edit apart; a plugin's is never edited.
  useSettingsUnsavedChanges(!plugin && comparable(draft) !== comparable(baseline));
  const [baseRevision, setBaseRevision] = useState(expectedRevision);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [inputOptionsOpen, setInputOptionsOpen] = useState(false);
  const problems = useCommandProblems(draft);
  const nameError = problems.text('name');
  const errorMessage = useRef<HTMLDivElement>(null);
  const footerRef = useOverlayFooter<HTMLElement>();
  // Hands the work to a fresh panel session where the agent edits the command with its tools.
  const startSession = useCommandAiSession();
  function showError(message: string) {
    setError(message);
    if (message)
      requestAnimationFrame(() => errorMessage.current?.scrollIntoView({ block: 'nearest' }));
  }
  async function save() {
    // Save stays enabled while a request is in flight (focus stays on it); repeats are ignored.
    if (pending) return;
    setError('');
    // Field problems show under their fields; what remains here concerns the whole command.
    if (!problems.check()) return;
    try {
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
      setBaseline(current);
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
          const next = {
            ...draft,
            parameters,
            instructions:
              previousKey && previousKey !== value.key
                ? renameArgument(draft.instructions, previousKey, value.key)
                : draft.instructions,
          };
          setDraft(next);
          problems.recheck('parameters', next);
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
        className="settings-page-scroll"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
      >
        <fieldset
          disabled={Boolean(plugin)}
          className="editor-fields settings-groups min-w-0 p-0.75"
        >
          {plugin && (
            <Alert role="note">
              <Puzzle />
              <AlertDescription>{t('editor.pluginNotice', { plugin })}</AlertDescription>
            </Alert>
          )}
          <div className="field-columns aligned-fields">
            <div className="settings-field">
              <Label htmlFor="command-name">{t('editor.name')}</Label>
              {/* One grid row with the error, so the fields beside it stay aligned. */}
              <div className="flex flex-col gap-2">
                <Input
                  id="command-name"
                  value={draft.name}
                  maxLength={120}
                  placeholder={t('editor.namePlaceholder')}
                  aria-invalid={Boolean(nameError) || undefined}
                  aria-describedby={nameError ? errorId('name') : undefined}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  onBlur={() => problems.recheck('name')}
                />
                {nameError && <FieldError id={errorId('name')}>{nameError}</FieldError>}
              </div>
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
          <SettingsGroup
            id="command-instructions"
            title={t('instruction.title')}
            description={t('instruction.hint')}
          >
            <InstructionEditor
              command={draft}
              onChange={setDraft}
              onNormalize={(instructions) => {
                setDraft((current) => ({ ...current, instructions }));
                setBaseline((current) => ({ ...current, instructions }));
              }}
              readOnly={Boolean(plugin)}
              tasks={tasks}
              error={problems.text('instructions')}
              onBlur={() => problems.recheck('instructions')}
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
          </SettingsGroup>
          <ParameterList
            parameters={draft.parameters}
            onChange={(parameters) => {
              const next = { ...draft, parameters };
              setDraft(next);
              // Reordering or removing is what fixes a parameter problem, so check it again then.
              problems.recheck('parameters', next);
            }}
            onOpen={parameterPage.open}
            error={problems.text('parameters')}
          />
          <SettingsGroup
            id="command-start"
            title={t('start.title')}
            description={t('start.description')}
          >
            <InputOptions
              command={draft}
              onChange={setDraft}
              open={inputOptionsOpen}
              onOpenChange={setInputOptionsOpen}
              error={problems.text('input')}
              onBlur={() => problems.recheck('input')}
            />
            <PlacementSettings command={draft} onChange={setDraft} />
          </SettingsGroup>
          <RunSettings command={draft} onChange={setDraft} settings={settings} />
          {error && (
            <div ref={errorMessage} className="space-y-2">
              <p role="alert" className="settings-inline-error">
                <CircleAlert aria-hidden />
                {error}
              </p>
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
              disabled={!window.desktop?.settings}
              aria-disabled={pending || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => {
                if (!pending) void startSession(baseRevision ? draft.id : null);
              }}
            >
              <Sparkles data-icon="inline-start" />
              {baseRevision ? t('session.triggerEdit') : t('session.trigger')}
            </Button>
            <div>
              <Button
                variant="glass"
                aria-disabled={pending || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => {
                  if (!pending) onCancel();
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                aria-disabled={pending || undefined}
                aria-busy={pending || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => void save()}
              >
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
