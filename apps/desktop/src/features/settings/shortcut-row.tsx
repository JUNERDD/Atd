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
  error?: string;
}) {
  const { t } = useTranslation('settings');
  const recording = settings.recording === action;
  const keys = shortcutKeys(settings.bindings[action], settings.platform);
  const locked = settings.unavailable || settings.pending !== null;
  const errorId = `settings-shortcut-${action}-error`;

  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor={`shortcut-${action}`}>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle>{label}</ItemTitle>
          <ItemDescription className="whitespace-normal">{description}</ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto">
          {!settings.isDefault(action) && !recording && (
            <IconButton
              label={t('shortcuts.capture.reset')}
              aria-label={t('shortcuts.capture.resetLabel', { label })}
              disabled={locked || settings.recording !== null}
              onClick={() => void settings.resetShortcut(action)}
            >
              <RotateCcw />
            </IconButton>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="settings-shortcut-button aria-pressed:border-ring aria-pressed:ring-3 aria-pressed:ring-ring/30"
            aria-label={
              recording
                ? t('shortcuts.capture.cancelLabel', { label })
                : t('shortcuts.capture.changeLabel', { label, keys: keys.join(' ') })
            }
            aria-describedby={recording ? 'settings-shortcut-hint' : error ? errorId : undefined}
            aria-pressed={recording}
            disabled={locked || (settings.recording !== null && !recording)}
            onClick={() => {
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
        {error && (
          <ItemFooter id={errorId} className="settings-shortcut-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}
