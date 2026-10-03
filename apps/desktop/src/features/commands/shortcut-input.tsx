import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { IconButton } from '../../components/icon-button';
import { ShortcutRecorder } from '../../components/shortcut-recorder';
import { shortcutKeys } from '../../lib/shortcuts';
import { FieldError } from './field-error';
import { useCommandShortcutCapture } from './use-command-shortcut-capture';

const ERROR_ID = 'command-shortcut-error';

/** A command's shortcut on the shared recorder; a set shortcut adds Clear as its leading action. */
export function ShortcutInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('commands');
  const { capture, platform, error } = useCommandShortcutCapture(onChange);
  return (
    <div className="flex flex-col gap-2">
      <ShortcutRecorder
        id="command-shortcut"
        keys={value ? shortcutKeys(value, platform) : []}
        recording={capture.isRecording}
        emptyText={t('shortcut.recordShortcut')}
        aria-label={t('shortcut.record')}
        aria-describedby={error ? ERROR_ID : undefined}
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
      {error && <FieldError id={ERROR_ID}>{error}</FieldError>}
    </div>
  );
}
