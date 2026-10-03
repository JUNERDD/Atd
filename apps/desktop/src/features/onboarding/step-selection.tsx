import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { useSelectionToolbarSettings } from '../settings/use-selection-toolbar-settings';
import { GoalStatus, OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';
import { PermissionRow } from './permission-row';

/**
 * Step 3: the selection toolbar. The goal is the system's Accessibility grant, which the shell
 * reports live; the permission row opens System Settings, where macOS asks. Once granted, the
 * status invites a real try on the practice text in the display area (`art-selection.tsx`), which
 * shows the real toolbar. The toolbar's own switch sits beside it, as in Settings.
 */
export function SelectionStep({ snapshot, goals, focusHeading }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const settings = useSelectionToolbarSettings(snapshot);
  return (
    <OnboardingStep
      title={t('selection.title')}
      description={t('selection.description')}
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
        </ItemGroup>
      </Card>
    </OnboardingStep>
  );
}
