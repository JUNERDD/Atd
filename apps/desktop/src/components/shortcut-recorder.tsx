import { useId, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import { cn } from '@atd/ui/lib/utils';
import './shortcut-recorder.css';

/**
 * The app's one shortcut recorder, for every place a shortcut is recorded (the Shortcuts settings,
 * a command's shortcut): an outline pill holding the keys as keycaps, which records a new
 * combination when clicked and reads Press keys while it records. An unset shortcut shows
 * `emptyText` in the same pill. `action` (Reset, Clear) sits before the keys, so the keys keep the
 * trailing edge whether it shows or not, and it hides while recording. The recording hint is read
 * with the pill, which itself only shows Press keys.
 *
 * Collecting the keys (`useShortcutCapture`), validating and saving them stay with the caller.
 */
export function ShortcutRecorder({
  keys,
  recording,
  emptyText,
  action,
  className,
  'aria-describedby': describedBy,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size' | 'aria-pressed'> & {
  /** The shortcut as keycap labels (`shortcutKeys`); empty for an unset shortcut. */
  keys: readonly string[];
  recording: boolean;
  /** What the pill reads for an unset shortcut. */
  emptyText?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation('common');
  const hintId = useId();
  return (
    <div className="shortcut-recorder">
      {!recording && action}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          'shortcut-recorder-keys aria-pressed:border-ring aria-pressed:ring-3 aria-pressed:ring-ring/30',
          className,
        )}
        aria-pressed={recording}
        aria-describedby={recording ? hintId : describedBy}
        {...props}
      >
        {recording ? (
          t('shortcuts.pressKeys')
        ) : keys.length ? (
          <KbdGroup aria-hidden="true">
            {keys.map((key, index) => (
              <Kbd key={`${index}-${key}`}>{key}</Kbd>
            ))}
          </KbdGroup>
        ) : (
          emptyText
        )}
      </Button>
      <span id={hintId} className="sr-only">
        {t('shortcuts.recordingHint')}
      </span>
    </div>
  );
}
