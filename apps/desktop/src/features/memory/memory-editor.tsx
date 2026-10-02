import { useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { Textarea } from '@atd/ui/components/textarea';
import type { MemoryEntry } from '../../client/agent/bridge';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { FieldError } from '../commands/field-error';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsUnsavedChanges } from '../settings/settings-unsaved-changes';

/**
 * One memory's editor page. It mounts with the entry's saved content, so every opening, Forward's
 * included, starts afresh; while the text differs from the saved content, leaving asks first.
 */
export function MemoryEditor({
  entry,
  busy,
  feedback,
  onSave,
  onDelete,
  onCancel,
}: {
  /** The entry as the latest snapshot has it. */
  entry: MemoryEntry;
  /** This entry is saving: the controls keep focus but ignore input. */
  busy: boolean;
  /** The section's load failure and its Reload, if any. */
  feedback: ReactNode;
  onSave: (content: string) => void;
  /** Asks to delete the entry. */
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('memory');
  const [content, setContent] = useState(entry.content);
  /** Empty content on Save; checked again when focus leaves the field. */
  const [contentError, setContentError] = useState('');
  const footerRef = useOverlayFooter<HTMLElement>();
  useSettingsUnsavedChanges(content !== entry.content);
  function save() {
    if (busy) return;
    if (!content.trim()) setContentError(t('memory.feedback.emptyContent'));
    else onSave(content);
  }
  return (
    <div className="command-editor">
      <SettingsHeading title={t('memory.edit.title')} subpage backLabel={t('memory.edit.back')} />
      <ScrollArea
        className="settings-page-scroll"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
      >
        <div className="settings-editor-inner">
          <div className="settings-field">
            <Label htmlFor="memory-content">{t('memory.edit.fieldLabel')}</Label>
            <Textarea
              id="memory-content"
              rows={6}
              maxLength={20000}
              value={content}
              aria-invalid={Boolean(contentError) || undefined}
              aria-describedby={contentError ? 'memory-content-error' : undefined}
              onChange={(event) => setContent(event.target.value)}
              onBlur={() => {
                if (contentError && content.trim()) setContentError('');
              }}
            />
            {contentError && <FieldError id="memory-content-error">{contentError}</FieldError>}
            <p className="text-xs text-muted-foreground">{t('memory.edit.note')}</p>
          </div>
          {feedback}
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        <Button
          variant="glass"
          aria-disabled={busy || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (!busy) onDelete();
          }}
        >
          <Trash2 />
          {t('memory.edit.delete')}
        </Button>
        <div>
          <Button
            variant="glass"
            aria-disabled={busy || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!busy) onCancel();
            }}
          >
            {t('memory.edit.cancel')}
          </Button>
          <Button
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={save}
          >
            {busy ? t('memory.edit.saving') : t('memory.edit.save')}
          </Button>
        </div>
      </footer>
    </div>
  );
}
