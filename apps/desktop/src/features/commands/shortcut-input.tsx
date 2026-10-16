import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Pencil, X } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from '@atd/ui/components/item';
import { IconButton } from '../../components/icon-button';
import { ShortcutRecorder } from '../../components/shortcut-recorder';
import { shortcutKeys } from '../../lib/shortcuts';
import { useCommandShortcutCapture } from './use-command-shortcut-capture';

/** A row action beside the recorder: its tooltip and the accessible name naming the shortcut. */
interface RowAction {
  label: string;
  ariaLabel: string;
  onClick: () => void;
}

/**
 * One command shortcut as a settings row, the same anatomy as the Shortcuts settings' rows
 * (`ShortcutRow`): its title and a line under it, then the shared recorder at the trailing edge,
 * which records new keys in place when clicked. `remove` sits before the keys as the recorder's
 * leading action (it hides while recording) and `edit` after them, so every row of a list keeps
 * its actions in the same places whether or not it has keys. An invalid recording, else `error`
 * (a problem the editor found or a failed registration), shows inside the row. Render it inside
 * an `ItemGroup` in a `.settings-card`.
 */
export function CommandShortcutRow({
  id,
  title,
  description,
  accelerator,
  recordLabel,
  error,
  errorId,
  autoRecord = false,
  onRecorded,
  remove,
  edit,
}: {
  /** The recorder's id, and the prefix of the row's other element ids. */
  id: string;
  title: ReactNode;
  description: string;
  /** The keys; empty while none is recorded. */
  accelerator: string;
  recordLabel: string;
  error: string;
  /** The id of the element that shows `error`, which the editor scrolls to at save. */
  errorId: string;
  /** Starts recording as the row appears, as on a new shortcut's page. */
  autoRecord?: boolean;
  onRecorded: (accelerator: string) => void;
  remove?: RowAction | undefined;
  edit?: RowAction | undefined;
}) {
  const { t } = useTranslation('commands');
  const { capture, platform, error: recordError } = useCommandShortcutCapture(onRecorded);
  const shown = recordError || error;
  const descriptionId = `${id}-description`;
  const { start } = capture;
  useEffect(() => {
    if (autoRecord) start();
  }, [autoRecord, start]);
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle id={`${id}-title`} className="whitespace-normal">
            {title}
          </ItemTitle>
          <ItemDescription id={descriptionId} className="whitespace-normal">
            {description}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto">
          <ShortcutRecorder
            id={id}
            keys={accelerator ? shortcutKeys(accelerator, platform) : []}
            recording={capture.isRecording}
            doubleTap={platform === 'darwin'}
            emptyText={t('shortcut.recordShortcut')}
            aria-label={recordLabel}
            aria-describedby={[descriptionId, shown && errorId].filter(Boolean).join(' ')}
            aria-invalid={Boolean(shown) || undefined}
            onBlur={capture.cancel}
            onClick={() => {
              if (capture.isRecording) capture.cancel();
              else capture.start();
            }}
            action={
              remove && (
                <IconButton
                  label={remove.label}
                  aria-label={remove.ariaLabel}
                  onClick={() => {
                    capture.cancel();
                    remove.onClick();
                  }}
                >
                  <X />
                </IconButton>
              )
            }
          />
          {edit && (
            <IconButton label={edit.label} aria-label={edit.ariaLabel} onClick={edit.onClick}>
              <Pencil />
            </IconButton>
          )}
        </ItemActions>
        {shown && (
          <ItemFooter
            id={errorId}
            role="alert"
            className="settings-inline-error items-start justify-start"
          >
            <CircleAlert aria-hidden="true" />
            <span>{shown}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}
