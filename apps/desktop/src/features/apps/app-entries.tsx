import { AppWindow, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BarAction } from '../../components/bar-action';
import { preloadPanelView } from '../agent/panel-view-loaders';

/**
 * Create app and My apps on the new-task view, beside All commands: Create app seeds the new
 * draft with the `create-app` skill chip, My apps opens the panel's apps view. Short of room in the
 * launcher's one-line row, they show their icons alone.
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
      <BarAction
        variant="outline"
        icon={<Sparkles data-icon="inline-start" aria-hidden="true" />}
        label={t('panel.create')}
        onClick={onCreate}
      />
      <BarAction
        variant="outline"
        icon={<AppWindow data-icon="inline-start" aria-hidden="true" />}
        label={t('panel.label')}
        onPointerEnter={() => preloadPanelView('apps')}
        onFocus={() => preloadPanelView('apps')}
        onClick={onShowApps}
      />
    </>
  );
}
