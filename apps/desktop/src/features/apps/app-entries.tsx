import { AppWindow, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';

/**
 * Create app and My apps on the new-task view, beside All commands: Create app seeds the new
 * draft with the `create-app` skill chip, My apps opens the panel's apps view.
 */
export function AppEntries({
  onCreate,
  onShowApps,
}: {
  onCreate: () => void;
  onShowApps: () => void;
}) {
  const { t } = useTranslation('apps');
  return (
    <>
      <Button variant="outline" onClick={onCreate}>
        <Sparkles data-icon="inline-start" />
        {t('panel.create')}
      </Button>
      <Button variant="outline" onClick={onShowApps}>
        <AppWindow data-icon="inline-start" />
        {t('panel.label')}
      </Button>
    </>
  );
}
