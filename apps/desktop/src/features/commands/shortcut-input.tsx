import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { IconButton } from '../../components/icon-button';
import { ShortcutRecorder } from '../../components/shortcut-recorder';
import { recordedKeysToAccelerator, shortcutKeys } from '../../lib/shortcuts';
import { useShortcutCapture } from '../settings/use-shortcut-capture';
import { FieldError } from './field-error';

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
  const capture = useShortcutCapture();
  const platform = window.desktop?.platform ?? 'web';
  const { keys, isRecording, stop, resetKeys } = capture;
  const hasKey = [...keys].some((key) => !['meta', 'ctrl', 'alt', 'shift'].includes(key));
  const shortcut = recordedKeysToAccelerator(keys, platform);
  const invalid =
    !shortcut ||
    !shortcut.includes('+') ||
    (shortcut.startsWith('Shift+') && shortcut.split('+').length === 2);
  const error = hasKey && invalid ? t('shortcut.error') : '';
  useEffect(() => {
    if (!isRecording || !hasKey) return;
    stop();
    if (invalid || !shortcut) return;
    onChange(shortcut);
    resetKeys();
  }, [hasKey, invalid, shortcut, isRecording, stop, resetKeys, onChange]);
  return (
    <div className="flex flex-col gap-2">
      <ShortcutRecorder
        id="command-shortcut"
        keys={value ? shortcutKeys(value, platform) : []}
        recording={isRecording}
        emptyText={t('shortcut.recordShortcut')}
        aria-label={t('shortcut.record')}
        aria-describedby={error ? ERROR_ID : undefined}
        onBlur={capture.cancel}
        onClick={() => {
          if (isRecording) capture.cancel();
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
