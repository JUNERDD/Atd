import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { shortcutKeys } from '../../lib/shortcuts';
import { ShortcutConflictHint } from '../settings/shortcut-conflict-hint';
import { ShortcutRow } from '../settings/shortcut-row';
import { useShortcutSettings } from '../settings/use-shortcut-settings';
import { GoalStatus, KeysSentence, OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';

/**
 * Step 2: the global shortcut, tried for real. The goal is met when the shell reports the panel
 * shown while the guide is open, which only the real shortcut (or another summon) can do; the
 * status then confirms in place. The description sets the keys to press inline; below, the same
 * recorder row as Settings changes the shortcut and shows the registration error when the shell
 * could not register it.
 */
export function HotkeyStep({ snapshot, goals, focusHeading }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const { t: tSettings } = useTranslation('settings');
  const settings = useShortcutSettings(snapshot);
  const keys = shortcutKeys(settings.bindings.togglePanel, settings.platform);
  const failed = window.desktop !== undefined && snapshot?.shortcutAvailable === false;
  return (
    <OnboardingStep
      title={t('hotkey.title')}
      description={
        <KeysSentence sentence={(shortcut) => t('hotkey.description', { shortcut })} keys={keys} />
      }
      status={
        <GoalStatus
          met={goals.hotkey}
          waiting={t('hotkey.waiting')}
          success={t('hotkey.success')}
        />
      }
      focusHeading={focusHeading}
    >
      {/* The card and its note stay together, as in Settings › General. */}
      <div className="guide-group">
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <ShortcutRow
              action="togglePanel"
              label={t('hotkey.rowLabel')}
              description={t('hotkey.rowDescription')}
              settings={settings}
              error={failed ? tSettings('shortcuts.errors.register') : undefined}
            />
          </ItemGroup>
        </Card>
        {!failed && <ShortcutConflictHint />}
      </div>
    </OnboardingStep>
  );
}
