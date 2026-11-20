import { AppWindow, Blocks, MousePointerClick, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';

/**
 * The four feature pillars beyond the guided setup, in reading order, each paired with the icon
 * Settings uses for it in the sidebar.
 */
const FEATURES = [
  {
    id: 'computer',
    icon: MousePointerClick,
    titleKey: 'features.items.computer.title',
    descriptionKey: 'features.items.computer.description',
  },
  {
    id: 'extensions',
    icon: Blocks,
    titleKey: 'features.items.extensions.title',
    descriptionKey: 'features.items.extensions.description',
  },
  {
    id: 'apps',
    icon: AppWindow,
    titleKey: 'features.items.apps.title',
    descriptionKey: 'features.items.apps.description',
  },
  {
    id: 'automations',
    icon: Zap,
    titleKey: 'features.items.automations.title',
    descriptionKey: 'features.items.automations.description',
  },
] as const;

/**
 * Step 6: what else Atd does beyond what the guide sets up. An introduction rather than a goal
 * (so the primary simply continues): a compact settings card per pillar with its icon, name, and
 * description so all four fit without scrolling at standard desktop sizes. The guide itself never
 * runs a computer action, installs an extension, builds an app, or runs an automation.
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
        {FEATURES.map(({ id, icon: Icon, titleKey, descriptionKey }) => (
          <li key={id}>
            <Card size="sm" className="settings-card">
              <Item size="xs">
                <ItemMedia variant="icon">
                  <Icon aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="whitespace-normal">{t(titleKey)}</ItemTitle>
                  <ItemDescription className="text-pretty whitespace-normal">
                    {t(descriptionKey)}
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
