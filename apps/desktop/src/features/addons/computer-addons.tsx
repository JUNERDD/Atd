import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COMPUTER_BROWSER_ADDON } from '@atd/agent-contracts';
import { AddonCard, AddonCardGroup } from './addon-card';

/**
 * The engine of browser use as an install card, for the computer settings page: the browser
 * engine operates pages in Atd's managed Chrome profile. Apps need no add-on, since the app
 * engine is part of Atd. Drop it in under a group heading; it brings its own card.
 */
export function ComputerAddons() {
  const { t } = useTranslation('addons');
  return (
    <AddonCardGroup label={t('computer.label')}>
      <AddonCard
        id={COMPUTER_BROWSER_ADDON}
        icon={<Globe />}
        title={t('computer.browser.title')}
        description={t('computer.browser.description')}
      />
    </AddonCardGroup>
  );
}
