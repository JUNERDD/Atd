import { useEffect } from 'react';
import { Button } from '@ai/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@ai/ui/components/item';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';
import type { SettingsSnapshot, ShortcutAction } from '../../../electron/settings-contract';
import { shortcutKeys } from '../../lib/shortcuts';
import { useShortcutSettings } from './use-shortcut-settings';

const IN_APP_SHORTCUTS: { action: ShortcutAction; label: string; description: string }[] = [
  {
    action: 'newConversation',
    label: 'New conversation',
    description: 'Start with a clean composer.',
  },
  {
    action: 'openSettings',
    label: 'Open settings',
    description: 'Open this settings window.',
  },
  {
    action: 'sendMessage',
    label: 'Send message',
    description: 'Send the current message.',
  },
  {
    action: 'newLine',
    label: 'New line',
    description: 'Add a line without sending.',
  },
];

function ShortcutRow({
  action,
  label,
  description,
  settings,
}: {
  action: ShortcutAction;
  label: string;
  description: string;
  settings: ReturnType<typeof useShortcutSettings>;
}) {
  const recording = settings.recording === action;
  const keys = shortcutKeys(settings.bindings[action], settings.platform);

  return (
    <Item
      asChild
      variant={action === 'togglePanel' ? 'outline' : 'default'}
      size="xs"
      className="settings-shortcut-row"
    >
      <li>
        <ItemContent>
          <ItemTitle>{label}</ItemTitle>
          <ItemDescription>{description}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            variant="ghost"
            className="settings-shortcut-button"
            aria-label={
              recording ? `Cancel recording ${label}` : `Change ${label}: ${keys.join(' ')}`
            }
            aria-describedby={recording ? 'settings-shortcut-status' : undefined}
            aria-pressed={recording}
            disabled={
              settings.unavailable ||
              settings.pending !== null ||
              (settings.recording !== null && !recording)
            }
            onClick={() => {
              if (recording) settings.cancelRecording();
              else settings.startRecording(action);
            }}
            onBlur={() => {
              if (recording) settings.cancelRecording();
            }}
          >
            {recording ? (
              'Press keys…'
            ) : (
              <KbdGroup aria-hidden="true">
                {keys.map((key, index) => (
                  <Kbd key={`${index}-${key}`}>{key}</Kbd>
                ))}
              </KbdGroup>
            )}
          </Button>
        </ItemActions>
      </li>
    </Item>
  );
}

export function ShortcutSettings({
  snapshot,
  onRecordingChange,
}: {
  snapshot: SettingsSnapshot | null;
  onRecordingChange: (recording: boolean) => void;
}) {
  const settings = useShortcutSettings(snapshot);
  const recording = settings.recording !== null;

  useEffect(() => {
    onRecordingChange(recording);
    return () => onRecordingChange(false);
  }, [onRecordingChange, recording]);

  return (
    <>
      <header className="settings-section-heading">
        <h2>Keyboard shortcuts</h2>
        <p>Make the app work at your pace. Click a shortcut to edit it.</p>
      </header>
      <div className="settings-shortcut-groups" aria-busy={settings.pending !== null}>
        <section className="settings-shortcut-group" aria-labelledby="settings-global-shortcuts">
          <h3 id="settings-global-shortcuts">Global</h3>
          <ItemGroup>
            <ShortcutRow
              action="togglePanel"
              label="Show or hide panel"
              description="Available anywhere on your Mac."
              settings={settings}
            />
          </ItemGroup>
          {snapshot?.shortcutAvailable === false && (
            <p className="settings-status" data-error="true" role="alert">
              This shortcut could not be registered. Choose another combination.
            </p>
          )}
        </section>
        <section className="settings-shortcut-group" aria-labelledby="settings-in-app-shortcuts">
          <h3 id="settings-in-app-shortcuts">In app</h3>
          <ItemGroup>
            {IN_APP_SHORTCUTS.map(({ action, label, description }) => (
              <ShortcutRow
                key={action}
                action={action}
                label={label}
                description={description}
                settings={settings}
              />
            ))}
          </ItemGroup>
        </section>
      </div>

      <div className="settings-shortcuts-footer">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="settings-pin-preference">
              <Label htmlFor="settings-always-on-top">Always on top</Label>
              <Switch
                id="settings-always-on-top"
                checked={settings.pinned}
                disabled={settings.unavailable || settings.pending !== null || recording}
                onCheckedChange={(value) => void settings.changePinned(value)}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>Keep the panel within reach.</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          variant="outline"
          disabled={settings.unavailable || settings.pending !== null || recording}
          onClick={() => void settings.restoreDefaults()}
        >
          {settings.pending === 'restore' ? 'Restoring…' : 'Restore defaults'}
        </Button>
      </div>
      {(settings.error || settings.status) && (
        <p
          id="settings-shortcut-status"
          className="settings-status"
          data-error={Boolean(settings.error)}
          role={settings.error ? 'alert' : 'status'}
        >
          {settings.error || settings.status}
        </p>
      )}
    </>
  );
}
