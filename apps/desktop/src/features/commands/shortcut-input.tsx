import { useEffect } from 'react';
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
  const capture = useShortcutCapture();
  const platform = window.desktop?.platform ?? 'web';
  const { keys, isRecording, stop, resetKeys } = capture;
  const hasKey = [...keys].some((key) => !['meta', 'ctrl', 'alt', 'shift'].includes(key));
  const shortcut = recordedKeysToAccelerator(keys, platform);
  const invalid =
    !shortcut ||
    !shortcut.includes('+') ||
    (shortcut.startsWith('Shift+') && shortcut.split('+').length === 2);
  const error = hasKey && invalid ? 'Include Command, Control, or Alt with a supported key.' : '';
  useEffect(() => {
    if (!isRecording || !hasKey) return;
    stop();
    if (invalid || !shortcut) return;
    onChange(shortcut);
    resetKeys();
  }, [hasKey, invalid, shortcut, isRecording, stop, resetKeys, onChange]);
  return (
    <div>
      <div className="flex items-center gap-2">
        <Button
          id="command-shortcut"
          type="button"
          variant="outline"
          className="flex-1"
          aria-label="Record command shortcut"
          aria-pressed={isRecording}
          onBlur={capture.cancel}
          onClick={() => {
            if (isRecording) capture.cancel();
            else capture.start();
          }}
        >
          {isRecording ? (
            'Press keys…'
          ) : value ? (
            <KbdGroup>
              {shortcutKeys(value, platform).map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          ) : (
            'Record shortcut'
          )}
        </Button>
        <IconButton
          label="Clear shortcut"
          disabled={!value}
          onClick={() => {
            capture.cancel();
            onChange('');
          }}
        >
          <X />
        </IconButton>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
