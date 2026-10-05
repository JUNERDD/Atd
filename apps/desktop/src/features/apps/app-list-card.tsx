import type { ReactNode } from 'react';
import { SquareArrowOutUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppSummary } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { ItemActions } from '@atd/ui/components/item';
import { IconButton } from '../../components/icon-button';
import { ListCard } from '../../components/list-card';
import { AppIcon } from './app-icon';
import type { AppActions } from './use-app-actions';

/**
 * One app wherever apps are listed, as a `ListCard` like Settings' plugin cards (Figma
 * `App / App list card · Rhea`): the app's icon and name with actions at the top right, its own
 * description, and at the foot the list's meta line and a status badge. In Settings the whole
 * card opens the app's page (`onShow`) and Open at the top right opens the app; in the panel the
 * whole card opens the app and the actions are the panel's Continue editing and More (`children`).
 */
export function AppListCard({
  app,
  meta,
  status,
  actions,
  onShow,
  children,
}: {
  app: AppSummary;
  /** The version and when the app was updated, worded by the list. */
  meta: string;
  /** What the app waits on, as a badge after the meta line (Settings: a permission). */
  status?: string | undefined;
  actions: AppActions;
  /** Settings: the whole card opens the app's page. */
  onShow?: () => void;
  /** Actions at the top right in place of Open (the panel's Continue editing and More). */
  children?: ReactNode;
}) {
  const { t } = useTranslation('apps');
  const { t: tSettings } = useTranslation('settings');
  const busy = actions.busy.has(app.id);
  const description = app.description.trim();
  const openApp = () => {
    if (!busy) void actions.open(app.id);
  };
  return (
    <ListCard
      media={<AppIcon appId={app.id} version={app.currentVersion} size="md" />}
      name={app.name}
      nameText={app.name}
      actions={
        <ItemActions className="gap-1">
          {onShow ? (
            <IconButton
              label={t('panel.open')}
              aria-label={t('panel.openLabel', { name: app.name })}
              aria-disabled={busy || undefined}
              onClick={openApp}
            >
              <SquareArrowOutUpRight />
            </IconButton>
          ) : null}
          {children}
        </ItemActions>
      }
      description={description || tSettings('extensions.detailNoDescription')}
      descriptionText={description || undefined}
      meta={meta}
      badges={status ? <Badge variant="secondary">{status}</Badge> : undefined}
      open={
        onShow
          ? { label: t('settings.showLabel', { name: app.name }), onOpen: onShow }
          : { label: t('panel.openLabel', { name: app.name }), onOpen: openApp }
      }
      busy={busy}
    />
  );
}
