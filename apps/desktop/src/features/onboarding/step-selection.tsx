import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { shortcutKeys } from '../../lib/shortcuts';
import { SelectionToolbarActivationRows } from '../settings/selection-toolbar-activation';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import {
  activationAccelerator,
  useSelectionToolbarSettings,
} from '../settings/use-selection-toolbar-settings';
import { GoalStatus, KeysSentence, OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';
import { PermissionRow } from './permission-row';

/**
 * Step 3: the selection toolbar. The goal is the system's Accessibility grant, which the shell
 * reports live; the permission row opens System Settings, where macOS asks. Once granted, the
 * status invites a real try on the practice text in the display area (`art-selection.tsx`), which
 * shows the real toolbar. The description sets the activation keys inline while they are needed;
 * below, the toolbar's own switch and the activation rows (which selections bring it up, the key
 * combination, and the toggle mode's HUD) sit beside the permission, as in Settings.
 */
export function SelectionStep({ snapshot, goals, focusHeading }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const settings = useSelectionToolbarSettings(snapshot);
  const { activation, activationKeys } = settings.value;
  const keys = shortcutKeys(
    activationAccelerator(activationKeys),
    window.desktop?.platform ?? 'web',
  );
  const sentence = (key: string) =>
    activation === 'hold'
      ? t('selection.descriptionHold', { key })
      : t('selection.descriptionToggle', { key });
  return (
    <OnboardingStep
      title={t('selection.title')}
      description={
        activation === 'always' ? (
          t('selection.description')
        ) : (
          <KeysSentence sentence={sentence} keys={keys} />
        )
      }
      status={
        <GoalStatus
          met={goals.selection}
          waiting={t('selection.waiting')}
          success={t('selection.success')}
        />
      }
      focusHeading={focusHeading}
    >
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <PermissionRow
            trusted={goals.selection}
            request={async () => {
              await window.desktop?.settings.requestAccessibility();
            }}
            copy={{
              title: t('selection.accessibility.title'),
              description: t('selection.accessibility.description'),
              granted: t('selection.accessibility.granted'),
              open: t('selection.accessibility.open'),
              error: t('selection.accessibility.error'),
            }}
          />
          <SettingsSwitchRow
            id="onboarding-selection-toolbar"
            title={t('selection.toggle')}
            checked={settings.value.enabled}
            disabled={settings.unavailable}
            pending={settings.pending}
            note={settings.errors.toggle}
            onCheckedChange={settings.setEnabled}
          />
          <SelectionToolbarActivationRows settings={settings} compact />
        </ItemGroup>
      </Card>
    </OnboardingStep>
  );
}
