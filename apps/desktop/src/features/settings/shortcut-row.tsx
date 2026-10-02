import { useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from '@ai/ui/components/item';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import type { ShortcutAction } from '../../client/settings-contract';
import { IconButton } from '../../components/icon-button';
import { shortcutKeys } from '../../lib/shortcuts';
import type { useShortcutSettings } from './use-shortcut-settings';

/**
 * One shortcut: its name and purpose, then the keys, which record a new combination when clicked.
 * A changed shortcut adds Reset before the keys, so the keys keep the trailing edge in every row.
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
          {!settings.isDefault(action) && !recording && (
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
          )}
          <Button
            ref={keysButton}
            type="button"
            variant="outline"
            size="sm"
            className="settings-shortcut-button aria-pressed:border-ring aria-pressed:ring-3 aria-pressed:ring-ring/30 data-recording-elsewhere:opacity-50"
            aria-label={
              recording
                ? t('shortcuts.capture.cancelLabel', { label })
                : t('shortcuts.capture.changeLabel', { label, keys: keys.join(' ') })
            }
            aria-describedby={
              recording ? 'settings-shortcut-hint' : shownError ? errorId : undefined
            }
            aria-pressed={recording}
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
          >
            {recording ? (
              t('shortcuts.capture.pressKeys')
            ) : (
              <KbdGroup aria-hidden="true">
                {keys.map((key, index) => (
                  <Kbd key={`${index}-${key}`}>{key}</Kbd>
                ))}
              </KbdGroup>
            )}
          </Button>
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
