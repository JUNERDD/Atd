import { AppWindow, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppSummary } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import { ListCardGrid } from '../../components/list-card';
import { AppListCard } from './app-list-card';
import type { AppActions } from './use-app-actions';

/**
 * The Apps overview's cards (Figma `App / Apps list content`), laid out as the plugin cards are:
 * each opens the app's page from anywhere on the card, with Open at its top right; the search
 * matches names and descriptions. A card whose app waits for a permission says so in a badge at
 * its foot.
 */
export function AppSettingsList({
  apps,
  query,
  actions,
  onShow,
  onClearSearch,
}: {
  apps: AppSummary[];
  query: string;
  actions: AppActions;
  onShow: (app: AppSummary) => void;
  onClearSearch: () => void;
}) {
  const { t, i18n } = useTranslation('apps');
  const shown = apps.filter(
    (app) =>
      !query.trim() ||
      matchFields(query, { name: app.name, description: app.description || undefined }),
  );
  if (!shown.length) {
    const searching = apps.length > 0;
    return (
      <div className="settings-extension-empty">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">{searching ? <SearchX /> : <AppWindow />}</EmptyMedia>
            <EmptyTitle>
              {searching ? t('settings.noMatches', { query: query.trim() }) : t('panel.empty')}
            </EmptyTitle>
            {!searching && <EmptyDescription>{t('settings.emptyDescription')}</EmptyDescription>}
          </EmptyHeader>
          {searching && (
            <EmptyContent>
              <Button variant="outline" onClick={onClearSearch}>
                {t('settings.clearSearch')}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </div>
    );
  }
  return (
    <ListCardGrid>
      {shown.map((app) => {
        const date = new Date(app.updatedAt).toLocaleDateString(i18n.language, {
          dateStyle: 'medium',
        });
        return (
          <AppListCard
            key={app.id}
            app={app}
            actions={actions}
            meta={t('settings.rowMeta', { version: app.currentVersion, date })}
            status={app.consents.length ? t('settings.waiting') : undefined}
            onShow={() => onShow(app)}
          />
        );
      })}
    </ListCardGrid>
  );
}
