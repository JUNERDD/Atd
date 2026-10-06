import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Sparkles } from 'lucide-react';
import {
  AutomationDraftSchema,
  parse,
  type AutomationDraft,
  type AutomationItem,
  type FolderRef,
} from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { AutomationConflictError } from '../../client/automations-contract';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { showErrorToast } from '../../components/toast-store';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { messageOf } from '../../lib/errors';
import { FieldError } from '../commands/field-error';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsUnsavedChanges } from '../settings/settings-unsaved-changes';
import { ActionFields } from './action-fields';
import { comparable, draftOf, savedDraft, type DraftPatch } from './automation-draft';
import { failureWords, folderNameOf, runBlockWords } from './automation-words';
import { DeliveryFields } from './delivery-fields';
import { PolicyFields } from './policy-fields';
import { RunNowButton } from './run-now-button';
import { AutomationStatusNotice } from './status-notice';
import { TRIGGER_ERROR_ID, TriggerFields } from './trigger-fields';
import { useAutomationAiSession } from './use-automation-ai-session';
import { errorId, useAutomationProblems } from './use-automation-problems';
import { automationsBridge, startRun, useTriggerPreview } from './use-automations';

/**
 * The editor of one automation (`saved`), or of a new one until it is saved: its name, when it
 * runs, what it does, how its unattended runs behave and how results reach the person. Save
 * checks the fields first, and a trigger the service's preview refuses; a revision conflict stays
 * inline with Reload. Run now runs the saved automation; with unsaved edits, or before the first
 * save, it saves and then runs, which is how a new automation is tried out. Create or Edit with AI
 * hands the work to a new panel session, as the command editor's does.
 */
export function AutomationEditor({
  initial,
  start,
  saved,
  unavailable,
  settings,
  automations,
  commands,
  onCancel,
  onSaved,
}: {
  initial: AutomationDraft;
  /**
   * What the editor opens with when it differs from `initial`, which unsaved changes are then
   * measured against: turning a finished one-time automation back on opens it switched on.
   */
  start?: AutomationDraft;
  /** The saved automation as the list has it now; null for a draft. */
  saved: AutomationItem | null;
  /** The saved automations cannot be read: nothing runs. */
  unavailable: boolean;
  settings: SettingsSnapshot | null;
  /** Every automation, for a chain trigger's choices and names; null until read. */
  automations: readonly AutomationItem[] | null;
  /** Saved commands, for a command action. */
  commands: readonly CommandDefinition[];
  onCancel: () => void;
  /** After a save; `thenRun` asks for the saved automation to run now. */
  onSaved: (item: AutomationItem, thenRun: boolean) => void;
}) {
  const { t } = useTranslation('automations');
  const automationId = saved?.automation.id ?? null;
  const [draft, setDraft] = useState(start ?? initial);
  // The draft as of the last change, for answers that land after other edits (a folder pick
  // while the modeless open panel stays up): they apply to it, never to an older render's draft.
  const latest = useRef(start ?? initial);
  // What the draft started from: the opened automation, or the latest one after a reload.
  const [baseline, setBaseline] = useState(initial);
  const [revision, setRevision] = useState(saved?.automation.revision ?? 0);
  // Bumped by a reload, which remounts the fields: their own text (an interval's number, the
  // file patterns) and what they kept per kind then start again from the reloaded draft.
  const [generation, setGeneration] = useState(0);
  const dirty = comparable(draft) !== comparable(baseline);
  useSettingsUnsavedChanges(dirty);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ text: string; conflict: boolean } | null>(null);
  // Folders picked here, by id. A folder saved earlier is named by the automations' statuses,
  // which leave out the name of one that is no longer registered.
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
  const folderName = (id: string) => picked[id] ?? folderNameOf(automations, id);
  const problems = useAutomationProblems(draft, commands, folderName);
  const preview = useTriggerPreview(draft.trigger, automationId);
  const footerRef = useOverlayFooter<HTMLElement>();
  const failureRef = useRef<HTMLDivElement>(null);
  // The panel session edits the saved automation with the agent's tools, not this draft.
  const startSession = useAutomationAiSession();
  const nameError = problems.text('name');

  function change(next: AutomationDraft) {
    latest.current = next;
    setDraft(next);
    problems.recheck(next);
  }
  const patch: DraftPatch = (update) => change(update(latest.current));
  const set = (part: Partial<AutomationDraft>) => change({ ...latest.current, ...part });
  function learnFolders(folders: readonly FolderRef[]) {
    setPicked((current) => ({
      ...current,
      ...Object.fromEntries(folders.map((folder) => [folder.id, folder.name])),
    }));
  }
  function showFailure(next: { text: string; conflict: boolean }) {
    setFailure(next);
    requestAnimationFrame(() => failureRef.current?.scrollIntoView({ block: 'nearest' }));
  }
  async function save(thenRun: boolean) {
    // Save stays enabled while a request is in flight (focus stays on it); repeats are ignored.
    if (pending) return;
    setFailure(null);
    if (!problems.check()) return;
    // The service refuses a trigger its preview refused; the trigger section says why.
    if (preview.preview?.problem && !preview.pending) {
      document.getElementById(TRIGGER_ERROR_ID)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    let checked: AutomationDraft;
    try {
      checked = parse(AutomationDraftSchema, savedDraft(draft, commands));
    } catch (error) {
      showFailure({ text: messageOf(error), conflict: false });
      return;
    }
    setPending(true);
    try {
      const bridge = automationsBridge();
      const item = automationId
        ? await bridge.update(automationId, revision, checked)
        : await bridge.create(checked);
      setPending(false);
      onSaved(item, thenRun);
    } catch (error) {
      setPending(false);
      showFailure(
        error instanceof AutomationConflictError
          ? { text: t('editor.conflict'), conflict: true }
          : { text: failureWords(error, t), conflict: false },
      );
    }
  }
  async function reload() {
    if (!automationId) return;
    try {
      const current = await automationsBridge().get(automationId);
      const next = draftOf(current.automation);
      latest.current = next;
      setDraft(next);
      setBaseline(next);
      setRevision(current.automation.revision);
      setFailure(null);
      problems.recheck(next);
      setGeneration((value) => value + 1);
      // Reload leaves with the error it answered; the form's first field takes the focus.
      requestAnimationFrame(() => document.getElementById('automation-name')?.focus());
    } catch (error) {
      showErrorToast(error);
    }
  }
  const busy = {
    'aria-disabled': pending || undefined,
    className: 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  };
  return (
    <section className="command-editor automation-editor" aria-label={t('editor.label')}>
      <SettingsHeading
        title={automationId ? t('editor.editTitle') : t('editor.newTitle')}
        subpage
        backLabel={t('editor.back')}
      />
      <ScrollArea
        className="settings-page-scroll"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
      >
        <div key={generation} className="editor-fields automation-editor-fields min-w-0 p-0.75">
          {saved && <AutomationStatusNotice status={saved.status} />}
          <div className="settings-field">
            <Label htmlFor="automation-name">{t('editor.name')}</Label>
            <Input
              id="automation-name"
              value={draft.name}
              maxLength={120}
              placeholder={t('editor.namePlaceholder')}
              aria-invalid={Boolean(nameError) || undefined}
              aria-describedby={nameError ? errorId('name') : undefined}
              onChange={(event) => set({ name: event.target.value })}
            />
            {nameError && <FieldError id={errorId('name')}>{nameError}</FieldError>}
          </div>
          <TriggerFields
            trigger={draft.trigger}
            onChange={(trigger) => set({ trigger })}
            patch={patch}
            automationId={automationId}
            automations={automations}
            folderName={folderName}
            onFoldersPicked={learnFolders}
            problems={problems}
            preview={preview}
          />
          <ActionFields
            action={draft.action}
            trigger={draft.trigger}
            onChange={(action) => set({ action })}
            patch={patch}
            commands={commands}
            problems={problems}
          />
          <PolicyFields
            draft={draft}
            onChange={change}
            patch={patch}
            settings={settings}
            commands={commands}
            folderName={folderName}
            onFoldersPicked={learnFolders}
            problems={problems}
          />
          <DeliveryFields delivery={draft.delivery} onChange={(delivery) => set({ delivery })} />
          {failure && (
            <div ref={failureRef} className="space-y-2">
              <p role="alert" className="settings-inline-error">
                <CircleAlert aria-hidden />
                {failure.text}
              </p>
              {failure.conflict && (
                <Button variant="outline" onClick={() => void reload()}>
                  {t('editor.reload')}
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        <div className="automation-editor-tools">
          <Button
            type="button"
            variant="glass"
            disabled={!window.desktop?.settings}
            {...busy}
            onClick={() => {
              if (pending) return;
              const automation = saved?.automation;
              void startSession(automation ? { id: automation.id, name: automation.name } : null);
            }}
          >
            <Sparkles data-icon="inline-start" />
            {saved ? t('session.triggerEdit') : t('session.trigger')}
          </Button>
          {saved && !dirty ? (
            <RunNowButton
              variant="glass"
              label={t('editor.runNow')}
              reason={runBlockWords(saved.status, unavailable, t)}
              busy={pending}
              onRun={() => startRun(saved, t)}
            />
          ) : (
            <RunNowButton
              variant="glass"
              label={t('editor.saveAndRun')}
              reason={null}
              busy={pending}
              onRun={() => void save(true)}
            />
          )}
        </div>
        <div>
          <Button
            variant="glass"
            {...busy}
            onClick={() => {
              if (!pending) onCancel();
            }}
          >
            {t('editor.cancel')}
          </Button>
          <Button {...busy} aria-busy={pending || undefined} onClick={() => void save(false)}>
            {pending ? t('editor.saving') : automationId ? t('editor.save') : t('editor.create')}
          </Button>
        </div>
      </footer>
    </section>
  );
}
