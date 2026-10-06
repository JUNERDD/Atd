import { useId } from 'react';
import { AppWindow, History, Pin, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';

/**
 * How apps work, in reading order, each with the icon the apps UI uses for it: Create app, My apps,
 * the pin toggle and Versions in the panel, and the app's Permissions in Settings.
 */
const POINTS: { id: 'create' | 'window' | 'desktop' | 'versions' | 'consent'; icon: LucideIcon }[] =
  [
    { id: 'create', icon: Sparkles },
    { id: 'window', icon: AppWindow },
    { id: 'desktop', icon: Pin },
    { id: 'versions', icon: History },
    { id: 'consent', icon: ShieldCheck },
  ];

/**
 * Step 6: apps the agent builds. An introduction rather than a goal (so the primary simply
 * continues): what an app is, then how apps work as a card of rows, the welcome plan's list,
 * and a note that building one uses the connected provider. The guide itself never builds an
 * app or sends anything to a model.
 */
export function AppsStep({ focusHeading }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const listHeading = useId();
  return (
    <OnboardingStep
      title={t('apps.title')}
      description={t('apps.description')}
      focusHeading={focusHeading}
    >
      <div className="guide-group">
        <h2 id={listHeading} className="settings-section-title">
          {t('apps.listLabel')}
        </h2>
        <Card size="sm" className="settings-card">
          <ItemGroup aria-labelledby={listHeading}>
            {POINTS.map(({ id, icon: Icon }) => (
              <Item key={id} asChild size="xs" className="settings-card-row">
                <li>
                  <ItemMedia variant="icon">
                    <Icon aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="whitespace-normal">{t(`apps.list.${id}`)}</ItemTitle>
                  </ItemContent>
                </li>
              </Item>
            ))}
          </ItemGroup>
        </Card>
        <p className="settings-field-note">{t('apps.footnote')}</p>
      </div>
    </OnboardingStep>
  );
}
