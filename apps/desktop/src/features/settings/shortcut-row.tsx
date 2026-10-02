import { useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, RotateCcw } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from '@atd/ui/components/item';
import type { ShortcutAction } from '../../client/settings-contract';
import { IconButton } from '../../components/icon-button';
import { ShortcutRecorder } from '../../components/shortcut-recorder';
import { shortcutKeys } from '../../lib/shortcuts';
import type { useShortcutSettings } from './use-shortcut-settings';

/**
 * One shortcut: its name and purpose, then the shared recorder, which records a new combination
 * when its keys are clicked. A changed shortcut adds Reset as the recorder's leading action.
 * While a shortcut change saves, the controls stay focusable but ignore input, and the saving
 * row is marked busy.
 */
export function ShortcutRow({
  action,
  label,
  description,
  settings,
  error,
}: {
  action: ShortcutAction;
  label: string;
  description: string;
  settings: ReturnType<typeof useShortcutSettings>;
  /** Why the keys do not work, such as a failed system registration; shown inside the row. */
  error?: string | undefined;
}) {
  const { t } = useTranslation('settings');
  const keysButton = useRef<HTMLButtonElement>(null);
  const recording = settings.recording === action;
  const keys = shortcutKeys(settings.bindings[action], settings.platform);
  const locked = settings.shortcutBusy !== null;
  const busy = settings.shortcutBusy === action || settings.shortcutBusy === 'all';
  // While another row records, this row's controls look unavailable and ignore the pointer:
  // pressing them keeps focus (and the recording) on that row instead of moving it here.
  const recordingElsewhere = settings.recording !== null && !recording;
  const inert = {
    'aria-disabled': locked || recordingElsewhere || undefined,
    'data-recording-elsewhere': recordingElsewhere || undefined,
    onMouseDown: (event: MouseEvent) => {
      if (recordingElsewhere) event.preventDefault();
    },
  };
  // The latest attempt's error in this row outranks the standing registration error.
  const shownError = settings.errors[action] ?? error;
  const errorId = `settings-shortcut-${action}-error`;

  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor={`shortcut-${action}`} aria-busy={busy || undefined}>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle className="whitespace-normal">{label}</ItemTitle>
          <ItemDescription className="whitespace-normal">{description}</ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto">
          <ShortcutRecorder
            ref={keysButton}
            keys={keys}
            recording={recording}
            className="data-recording-elsewhere:opacity-50"
            aria-label={
              recording
                ? t('shortcuts.capture.cancelLabel', { label })
                : t('shortcuts.capture.changeLabel', { label, keys: keys.join(' ') })
            }
            aria-describedby={shownError ? errorId : undefined}
            disabled={settings.unavailable}
            {...inert}
            onClick={() => {
              if (recordingElsewhere) return;
              if (recording) settings.cancelRecording();
              else settings.startRecording(action);
            }}
            onBlur={() => {
              if (recording) settings.cancelRecording();
            }}
            action={
              !settings.isDefault(action) && (
                <IconButton
                  label={t('shortcuts.capture.reset')}
                  aria-label={t('shortcuts.capture.resetLabel', { label })}
                  className="data-recording-elsewhere:opacity-50"
                  disabled={settings.unavailable}
                  {...inert}
                  onClick={() => {
                    if (recordingElsewhere) return;
                    // Reset disappears once the default is back, so focus moves on to the keys.
                    void settings.resetShortcut(action).then((reset) => {
                      if (reset) keysButton.current?.focus();
                    });
                  }}
                >
                  <RotateCcw />
                </IconButton>
              )
            }
          />
        </ItemActions>
        {shownError && (
          <ItemFooter
            id={errorId}
            className="settings-inline-error items-start justify-start"
            role="alert"
          >
            <CircleAlert aria-hidden="true" />
            <span>{shownError}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}
