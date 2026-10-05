import { useEffect, useId, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoryCreateRequest, MemorySaveRequest, MemoryUnit } from '@atd/agent-contracts';
import { Alert, AlertAction, AlertDescription } from '@atd/ui/components/alert';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsUnsavedChanges } from '../settings/settings-unsaved-changes';
import {
  MEMORY_CHECKED_FIELDS,
  createRequestOf,
  draftErrors,
  draftOf,
  saveRequestOf,
  sameContent,
  sameDraft,
} from './memory-draft';
import { MemoryFacts } from './memory-facts';
import { MemoryFields } from './memory-fields';

/**
 * Whether the page outlived its unit: deleted elsewhere while the page held unsaved edits, which
 * it then keeps for good, so undoing them never closes the page under the user. A page without
 * edits leaves through `onDiscard` instead.
 */
function useOrphaned(deleted: boolean, dirty: boolean, onDiscard: () => void): boolean {
  const [orphaned, setOrphaned] = useState(false);
  if (deleted && dirty && !orphaned) setOrphaned(true);
  const leave = deleted && !dirty && !orphaned;
  useEffect(() => {
    if (leave) onDiscard();
  }, [leave, onDiscard]);
  return orphaned;
}

/**
 * One memory's page, or the New memory page when `unit` is null: what the service records about
 * it, then its fields. It mounts with the unit's saved fields, so every opening starts afresh;
 * while the fields differ from them, leaving asks first. Opening an unreviewed unit clears its
 * New badge.
 *
 * A change saved elsewhere while the page is open (the agent, a learner) replaces untouched
 * fields; over edits, the page says so and offers Reload, and Save keeps the revision it opened,
 * so the service refuses to overwrite the other change. A unit's own switch or review changes its
 * revision but not its fields, so a save then goes ahead. A unit deleted elsewhere closes the page,
 * unless it holds edits: then the page says so and Create memory saves them as a new memory, as
 * the New memory page does.
 */
export function MemoryPage({
  unit,
  deleted,
  takenNames,
  busy,
  feedback,
  onCreate,
  onSave,
  onReviewed,
  onDelete,
  onDiscard,
  onCancel,
}: {
  /**
   * The unit as the latest snapshot has it (as last read, once deleted); null on the New memory
   * page.
   */
  unit: MemoryUnit | null;
  /** A read answered without the unit: it was deleted elsewhere. */
  deleted: boolean;
  /** The other units' names, which this one may not take. */
  takenNames: readonly string[];
  /**
   * A write from this page is running (a save, a delete, or a create): the actions keep focus but
   * ignore input.
   */
  busy: boolean;
  /** The section's load failure and its Reload, if any. */
  feedback: ReactNode;
  onCreate: (input: MemoryCreateRequest) => void;
  onSave: (input: MemorySaveRequest) => void;
  /** Clears the unit's New badge. */
  onReviewed: (id: string) => void;
  /** Asks to delete the unit. */
  onDelete: () => void;
  /** Leaves the page for good, without asking. */
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('memory');
  const formId = useId();
  const footerRef = useOverlayFooter<HTMLElement>();
  /** The saved unit the draft started from, or last reloaded. */
  const [base, setBase] = useState(unit);
  const [draft, setDraft] = useState(() => draftOf(unit));
  const [attempted, setAttempted] = useState(false);
  /** Starts the draft over from the unit as the latest snapshot has it. */
  const reload = () => {
    setBase(unit);
    setDraft(draftOf(unit));
    setAttempted(false);
  };
  const dirty = !sameDraft(draft, draftOf(base));
  const changed = Boolean(unit && base && !sameContent(unit, base));
  // A newer version replaces fields left as they were, or ones it already matches (this page's
  // own save, just before the page leaves).
  if (changed && (!dirty || sameDraft(draft, draftOf(unit)))) reload();
  useSettingsUnsavedChanges(dirty);
  const orphaned = useOrphaned(deleted, dirty, onDiscard);
  // An orphaned page saves its edits as a new memory, through the New memory page's path.
  const creating = unit === null || orphaned;
  const errors = attempted ? draftErrors(draft, { creating, takenNames }) : {};
  const unreviewed = unit !== null && !unit.reviewed;
  const id = unit?.id;
  useEffect(() => {
    if (id && unreviewed) onReviewed(id);
  }, [id, unreviewed, onReviewed]);

  function submit() {
    if (busy) return;
    const problems = draftErrors(draft, { creating, takenNames });
    setAttempted(true);
    const first = MEMORY_CHECKED_FIELDS.find((field) => problems[field]);
    if (first) {
      document.getElementById(`${formId}-${first}`)?.focus();
      return;
    }
    if (creating || !unit || !base) {
      onCreate(createRequestOf(draft));
      return;
    }
    const request = saveRequestOf(draft, base, changed ? base.revision : unit.revision);
    if (request) onSave(request);
    else onCancel();
  }

  const guarded = (action: () => void) => () => {
    if (!busy) action();
  };
  const busyProps = {
    'aria-disabled': busy || undefined,
    className: 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  };
  return (
    <div className="command-editor">
      <SettingsHeading
        title={unit ? unit.name : t('memory.page.newTitle')}
        titleHint={
          unit && !unit.enabled ? (
            <Badge variant="outline">{t('memory.page.disabled')}</Badge>
          ) : null
        }
        subpage
        backLabel={t('memory.page.back')}
      />
      <ScrollArea
        className="settings-page-scroll"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
      >
        <div className="settings-editor-inner editor-fields">
          {orphaned ? (
            <Alert>
              <AlertDescription>{t('memory.page.deleted')}</AlertDescription>
            </Alert>
          ) : changed && dirty ? (
            <Alert>
              <AlertDescription>{t('memory.page.changed')}</AlertDescription>
              <AlertAction>
                <Button type="button" variant="outline" size="sm" onClick={reload}>
                  {t('memory.page.reload')}
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          {unit ? <MemoryFacts unit={unit} /> : null}
          <form
            id={formId}
            className="editor-fields"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <MemoryFields
              idPrefix={formId}
              draft={draft}
              errors={errors}
              creating={creating}
              onChange={setDraft}
            />
          </form>
          {feedback}
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        {creating ? null : (
          <Button type="button" variant="glass" {...busyProps} onClick={guarded(onDelete)}>
            <Trash2 />
            {t('memory.page.delete')}
          </Button>
        )}
        <div>
          <Button type="button" variant="glass" {...busyProps} onClick={guarded(onCancel)}>
            {t('memory.page.cancel')}
          </Button>
          <Button type="submit" form={formId} {...busyProps} aria-busy={busy || undefined}>
            {busy
              ? t('memory.page.saving')
              : creating
                ? t('memory.page.create')
                : t('memory.page.save')}
          </Button>
        </div>
      </footer>
    </div>
  );
}
