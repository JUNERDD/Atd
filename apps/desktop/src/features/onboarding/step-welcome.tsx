import { useId } from 'react';
import { Camera, Keyboard, Plug, TextSelect, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import i18n from '../../i18n';
import { isAppLanguage } from '../../client/settings-contract';
import { LanguageSelector } from '../settings/language-selector';
import { OnboardingStep } from './onboarding-step';
import type { GoalStepId, StepRenderProps } from './onboarding-types';

const PLAN: { id: GoalStepId; icon: LucideIcon }[] = [
  { id: 'hotkey', icon: Keyboard },
  { id: 'selection', icon: TextSelect },
  { id: 'screenshot', icon: Camera },
  { id: 'provider', icon: Plug },
];

/**
 * Step 1: the welcome, what the guide sets up (a card of rows, as Settings lists things), and the
 * language picker in a settings row, so the rest of the guide reads in the chosen language.
 */
export function WelcomeStep({ snapshot, focusHeading }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const planHeading = useId();
  // Until the snapshot arrives, the picker shows the language the page resolved from the OS.
  const shown =
    snapshot?.language ?? (isAppLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en');
  return (
    <OnboardingStep
      title={t('welcome.title')}
      description={t('welcome.description')}
      focusHeading={focusHeading}
    >
      <div className="guide-group">
        <h2 id={planHeading} className="settings-section-title">
          {t('welcome.planLabel')}
        </h2>
        <Card size="sm" className="settings-card">
          <ItemGroup aria-labelledby={planHeading}>
            {PLAN.map(({ id, icon: Icon }) => (
              <Item key={id} asChild size="xs" className="settings-card-row">
                <li>
                  <ItemMedia variant="icon">
                    <Icon aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="whitespace-normal">{t(`welcome.plan.${id}`)}</ItemTitle>
                  </ItemContent>
                </li>
              </Item>
            ))}
          </ItemGroup>
        </Card>
      </div>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <Item asChild size="sm" className="settings-card-row">
            <li>
              <ItemContent className="min-w-[min(120px,100%)]">
                <ItemTitle className="whitespace-normal">{t('welcome.language')}</ItemTitle>
              </ItemContent>
              <ItemActions className="ml-auto">
                <LanguageSelector language={shown} />
              </ItemActions>
            </li>
          </Item>
        </ItemGroup>
      </Card>
    </OnboardingStep>
  );
}
