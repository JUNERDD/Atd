import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Folder, FolderX } from 'lucide-react';
import type { AutomationFolderEvent, AutomationTrigger, FolderRef } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import { Input } from '@atd/ui/components/input';
import { ItemGroup } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import { FieldError } from '../commands/field-error';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { splitPatterns, type DraftPatch } from './automation-draft';
import { errorId, type AutomationProblemsView } from './use-automation-problems';
import { useFolderPicker } from './use-folder-picker';

type FolderTrigger = Extract<AutomationTrigger, { kind: 'folder' }>;

const EVENTS: readonly AutomationFolderEvent[] = ['added', 'changed'];

/**
 * A folder trigger's fields: the watched folder (picked with the shell's folder picker, which
 * registers it), which changes count, which file names, and whether subfolders count. A watched
 * folder that is no longer registered says so and offers to choose it again; the preview reports
 * the same refusal under the trigger.
 */
export function FolderTriggerFields({
  trigger,
  onChange,
  patch,
  folderName,
  onFoldersPicked,
  problems,
}: {
  trigger: FolderTrigger;
  onChange: (trigger: FolderTrigger) => void;
  /** For the pick, which lands after the edits made while the open panel was up. */
  patch: DraftPatch;
  /** The watched folder's name; undefined while none is chosen or once it is no longer registered. */
  folderName: string | undefined;
  onFoldersPicked: (folders: readonly FolderRef[]) => void;
  problems: AutomationProblemsView;
}) {
  const { t } = useTranslation('automations');
  // The text keeps what is typed; the trigger holds the patterns it splits into.
  const [patterns, setPatterns] = useState(() => trigger.patterns.join(', '));
  const picker = useFolderPicker();
  const choose = () =>
    picker.pick(([folder]) => {
      if (!folder) return;
      onFoldersPicked([folder]);
      // Only the folder changes: names and patterns typed while the open panel was up stay.
      patch((draft) =>
        draft.trigger.kind === 'folder'
          ? { ...draft, trigger: { ...draft.trigger, folderId: folder.id } }
          : draft,
      );
    });
  const state = !trigger.folderId ? 'none' : folderName === undefined ? 'unavailable' : 'chosen';
  const folderError = problems.text('folder');
  const eventsError = problems.text('events');
  const patternsError = problems.text('patterns');
  return (
    <div className="automation-field-stack">
      <div className="settings-field">
        <Label id="automation-folder-label">{t('folder.folder')}</Label>
        <div className="automation-folder-choice" data-state={state}>
          {state === 'unavailable' ? (
            <FolderX aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span id="automation-folder-value" className="min-w-0 flex-1 truncate" title={folderName}>
            {state === 'chosen'
              ? folderName
              : state === 'unavailable'
                ? t('folder.unavailable')
                : t('folder.none')}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-busy={picker.picking || undefined}
            aria-describedby={
              folderError
                ? `automation-folder-value ${errorId('folder')}`
                : 'automation-folder-value'
            }
            onClick={() => void choose()}
          >
            {state === 'none'
              ? t('folder.choose')
              : state === 'unavailable'
                ? t('folder.chooseAgain')
                : t('folder.change')}
          </Button>
        </div>
        {folderError && <FieldError id={errorId('folder')}>{folderError}</FieldError>}
        {picker.failure && (
          <p role="alert" className="settings-inline-error">
            <CircleAlert aria-hidden />
            {picker.failure}
          </p>
        )}
      </div>
      <div className="settings-field">
        <Label id="automation-events-label">{t('folder.events')}</Label>
        <Card size="sm" className="settings-card">
          <ItemGroup aria-labelledby="automation-events-label">
            {EVENTS.map((event) => (
              <SettingsSwitchRow
                key={event}
                id={`automation-folder-${event}`}
                title={t(`folder.${event}`)}
                description={t(`folder.${event}Description`)}
                checked={trigger.events.includes(event)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...trigger,
                    events: checked
                      ? [...trigger.events, event]
                      : trigger.events.filter((item) => item !== event),
                  })
                }
              />
            ))}
          </ItemGroup>
        </Card>
        {eventsError && <FieldError id={errorId('events')}>{eventsError}</FieldError>}
      </div>
      <div className="settings-field">
        <Label htmlFor="automation-patterns">{t('folder.patterns')}</Label>
        <Input
          id="automation-patterns"
          value={patterns}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={t('folder.patternsPlaceholder')}
          aria-invalid={Boolean(patternsError) || undefined}
          aria-describedby={patternsError ? errorId('patterns') : 'automation-patterns-note'}
          onChange={(event) => {
            setPatterns(event.target.value);
            onChange({ ...trigger, patterns: splitPatterns(event.target.value) });
          }}
        />
        {patternsError ? (
          <FieldError id={errorId('patterns')}>{patternsError}</FieldError>
        ) : (
          <p id="automation-patterns-note" className="settings-field-note">
            {t('folder.patternsNote')}
          </p>
        )}
      </div>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <SettingsSwitchRow
            id="automation-folder-recursive"
            title={t('folder.recursive')}
            description={t('folder.recursiveDescription')}
            checked={trigger.recursive}
            onCheckedChange={(recursive) => onChange({ ...trigger, recursive })}
          />
        </ItemGroup>
      </Card>
    </div>
  );
}
