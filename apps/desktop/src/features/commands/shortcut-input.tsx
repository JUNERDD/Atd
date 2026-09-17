import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import { IconButton } from '../../components/icon-button';
import { recordedKeysToAccelerator, shortcutKeys } from '../../lib/shortcuts';
import { useShortcutCapture } from '../settings/use-shortcut-capture';

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
    <div>
      <div className="relative">
        <Button
          id="command-shortcut"
          type="button"
          variant="outline"
          className="w-full pr-9"
          aria-label={t('shortcut.record')}
          aria-pressed={isRecording}
          onBlur={capture.cancel}
          onClick={() => {
            if (isRecording) capture.cancel();
            else capture.start();
          }}
        >
          {isRecording ? (
            t('shortcut.recording')
          ) : value ? (
            <KbdGroup>
              {shortcutKeys(value, platform).map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          ) : (
            t('shortcut.recordShortcut')
          )}
        </Button>
        {value && (
          <IconButton
            label={t('shortcut.clear')}
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => {
              capture.cancel();
              onChange('');
            }}
          >
            <X />
          </IconButton>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
