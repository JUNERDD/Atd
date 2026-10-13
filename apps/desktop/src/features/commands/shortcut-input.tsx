import { useTranslation } from 'react-i18next';
import { CircleAlert, X } from 'lucide-react';
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

const ERROR_ID = 'command-shortcut-error';
const DESCRIPTION_ID = 'command-shortcut-description';

/**
 * A command's shortcut as a settings row, the same anatomy as the Shortcuts settings' rows
 * (`ShortcutRow`): its name and a line under it, with the shared recorder at the trailing edge and
 * Clear as the recorder's leading action once a shortcut is set. The line says what the shortcut
 * does until one is set; once set, it says what to do when the keys do nothing, which another app
 * holding the combination explains and the app cannot detect. An invalid recording shows inside
 * the row. Render it inside an `ItemGroup` in a `.settings-card`.
 */
export function ShortcutInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('commands');
  const { capture, platform, error } = useCommandShortcutCapture(onChange);
  const describedBy = [DESCRIPTION_ID, error && ERROR_ID].filter(Boolean).join(' ');
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle id="command-shortcut-title" className="whitespace-normal">
            {t('input.shortcut')}
          </ItemTitle>
          <ItemDescription id={DESCRIPTION_ID} className="whitespace-normal">
            {t(value ? 'shortcut.conflictHint' : 'shortcut.description')}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto">
          <ShortcutRecorder
            id="command-shortcut"
            keys={value ? shortcutKeys(value, platform) : []}
            recording={capture.isRecording}
            doubleTap={platform === 'darwin'}
            emptyText={t('shortcut.recordShortcut')}
            aria-label={t('shortcut.record')}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error) || undefined}
            onBlur={capture.cancel}
            onClick={() => {
              if (capture.isRecording) capture.cancel();
              else capture.start();
            }}
            action={
              value && (
                <IconButton
                  label={t('shortcut.clear')}
                  onClick={() => {
                    capture.cancel();
                    onChange('');
                  }}
                >
                  <X />
                </IconButton>
              )
            }
          />
        </ItemActions>
        {error && (
          <ItemFooter
            id={ERROR_ID}
            role="alert"
            className="settings-inline-error items-start justify-start"
          >
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}
