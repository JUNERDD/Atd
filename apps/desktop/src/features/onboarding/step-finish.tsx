import { useId, useState } from 'react';
import { Circle, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import { DEFAULT_SHORTCUTS } from '@atd/agent-contracts';
import { showErrorToast } from '../../components/toast-store';
import { shortcutKeys } from '../../lib/shortcuts';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { OnboardingStep } from './onboarding-step';
import {
  GOAL_STEPS,
  type GoalStepId,
  type OnboardingStepId,
  type StepRenderProps,
} from './onboarding-types';

/**
 * One goal and its state: a check or an empty circle, the step's name, and the state in words for
 * screen readers. An unfinished goal offers "Do it now", which shows its step.
 */
function GoalRow({
  step,
  met,
  onDo,
}: {
  step: GoalStepId;
  met: boolean;
  onDo: (step: OnboardingStepId) => void;
}) {
  const { t } = useTranslation('onboarding');
  const name = t(`chrome.stepNames.${step}`);
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemMedia variant="icon" className="guide-row-icon" data-done={met || undefined}>
          {met ? <CircleCheck aria-hidden="true" /> : <Circle aria-hidden="true" />}
        </ItemMedia>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle className="whitespace-normal">
            {name}
            <span className="sr-only">: {met ? t('goal.done') : t('goal.notDone')}</span>
          </ItemTitle>
        </ItemContent>
        {/* The slot is as tall as the small button, so a row keeps its height whether or not it
            offers the action, and a goal turning met does not shift the list. */}
        <ItemActions className="ml-auto h-7">
          {!met && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('finish.doItNowLabel', { step: name })}
              onClick={() => onDo(step)}
            >
              {t('finish.doItNow')}
            </Button>
          )}
        </ItemActions>
      </li>
    </Item>
  );
}

/**
 * The login item switch. It shows the snapshot's live login item, which the shell updates with the
 * state macOS applied: that stays off while a new login item waits for approval in System Settings,
 * and the note then says so. A failure is a toast.
 */
function OpenAtLoginRow({ value }: { value: boolean }) {
  const { t } = useTranslation('onboarding');
  const [pending, setPending] = useState(false);
  const [approval, setApproval] = useState(false);
  async function change(next: boolean) {
    const desktop = window.desktop;
    if (!desktop) return;
    setPending(true);
    setApproval(false);
    try {
      const applied = await desktop.setOpenAtLogin(next);
      setApproval(next && !applied);
    } catch (reason) {
      showErrorToast(reason);
    }
    setPending(false);
  }
  return (
    <SettingsSwitchRow
      id="onboarding-open-at-login"
      title={t('finish.login.title')}
      checked={value}
      pending={pending}
      disabled={!window.desktop}
      note={approval && !value ? t('finish.login.approval') : undefined}
      onCheckedChange={(next) => void change(next)}
    />
  );
}

/**
 * Step 7: the summary. Each goal with its real state (unfinished ones lead back to their step), a
 * few first things to try with the user's own keys, and the login item where the shell supports
 * one, each as a card of settings rows. The primary action (in the footer) closes the guide and
 * summons the panel.
 */
export function FinishStep({ snapshot, goals, focusHeading, goTo }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const complete = GOAL_STEPS.every((step) => goals[step]);
  const platform = window.desktop?.platform ?? 'web';
  const bindings = snapshot?.shortcuts ?? DEFAULT_SHORTCUTS;
  const tips = [
    { id: 'toggle', keys: shortcutKeys(bindings.togglePanel, platform) },
    { id: 'screenshot', keys: shortcutKeys(bindings.captureScreenshot, platform) },
    { id: 'mention', keys: ['@'] },
    { id: 'commands', keys: ['/'] },
    { id: 'settings', keys: shortcutKeys(bindings.openSettings, platform) },
  ] as const;
  const openAtLogin = snapshot?.openAtLogin ?? null;
  const tipsHeading = useId();
  return (
    <OnboardingStep
      title={complete ? t('finish.title') : t('finish.titleIncomplete')}
      description={complete ? t('finish.description') : t('finish.descriptionIncomplete')}
      focusHeading={focusHeading}
    >
      <Card size="sm" className="settings-card">
        <ItemGroup aria-label={t('finish.goalsLabel')}>
          {GOAL_STEPS.map((step) => (
            <GoalRow key={step} step={step} met={goals[step]} onDo={goTo} />
          ))}
        </ItemGroup>
      </Card>
      <div className="guide-group">
        <h2 id={tipsHeading} className="settings-section-title">
          {t('finish.tips.label')}
        </h2>
        <Card size="sm" className="settings-card">
          <ItemGroup aria-labelledby={tipsHeading}>
            {tips.map((tip) => (
              <Item key={tip.id} asChild size="xs" className="settings-card-row">
                <li>
                  <ItemContent className="min-w-[min(120px,100%)]">
                    <ItemTitle className="whitespace-normal">
                      {t(`finish.tips.${tip.id}`)}
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions className="ml-auto">
                    <KbdGroup aria-label={tip.keys.join(' ')}>
                      {tip.keys.map((key, index) => (
                        <Kbd key={`${index}-${key}`}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  </ItemActions>
                </li>
              </Item>
            ))}
          </ItemGroup>
        </Card>
      </div>
      {openAtLogin !== null && (
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <OpenAtLoginRow value={openAtLogin} />
          </ItemGroup>
        </Card>
      )}
    </OnboardingStep>
  );
}
