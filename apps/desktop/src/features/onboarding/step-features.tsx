import { AppWindow, PanelRight, Zap, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';

/**
 * The features, in reading order, each with the icon Settings gives it (Apps and Automations in
 * the sidebar); the mini panel, a Window setting without one, takes the panel at a screen edge.
 */
const FEATURES: { id: 'apps' | 'automations' | 'miniPanel'; icon: LucideIcon }[] = [
  { id: 'apps', icon: AppWindow },
  { id: 'automations', icon: Zap },
  { id: 'miniPanel', icon: PanelRight },
];

/**
 * Step 6: what else Atd does beyond what the guide sets up. An introduction rather than a goal
 * (so the primary simply continues): a settings card per feature with its icon, name and one
 * line. The copy is kept short so the step fits the body without scrolling on every Mac display
 * (down to the 1024 × 640 "Larger Text" scale). The guide itself never builds an app, runs an
 * automation or sends anything to a model.
 */
export function FeaturesStep({ focusHeading }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  return (
    <OnboardingStep
      title={t('features.title')}
      description={t('features.description')}
      focusHeading={focusHeading}
    >
      <ul className="guide-features">
        {FEATURES.map(({ id, icon: Icon }) => (
          <li key={id}>
            <Card size="sm" className="settings-card">
              <Item size="sm">
                <ItemMedia variant="icon">
                  <Icon aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="whitespace-normal">
                    {t(`features.items.${id}.title`)}
                  </ItemTitle>
                  <ItemDescription className="text-pretty whitespace-normal">
                    {t(`features.items.${id}.description`)}
                  </ItemDescription>
                </ItemContent>
              </Item>
            </Card>
          </li>
        ))}
      </ul>
    </OnboardingStep>
  );
}
