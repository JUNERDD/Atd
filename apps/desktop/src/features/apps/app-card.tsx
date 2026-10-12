import { History, LayoutDashboard, SquareArrowOutUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppBuildDetails } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { ToolCard } from '../agent/transcript/tool-card';
import { AppIcon } from './app-icon';
import { useAppActions } from './use-app-actions';

/**
 * The app an `app.build` call published (Figma `App / App card`), shown at its turn's end with the
 * turn's other saved items (agent/transcript/artifact-cards.tsx) as of the turn's last build: the
 * icon, name, version and widget count, the build's change note, then Open and Version history.
 * A later build of the same run updates the version an earlier one published, so its badge says
 * the version was updated rather than naming it as if it were new. Type errors that did not stop
 * the build read as a warning footer. Only a build that published has details, so the card never
 * shows a build in progress or one that failed; its tool row does.
 */
export function AppCard({ details }: { details: AppBuildDetails }) {
  const { t } = useTranslation('apps');
  const actions = useAppActions();
  const busy = actions.busy.has(details.appId);
  const available = Boolean(window.desktop?.apps);
  const errors = details.typecheck.ok ? 0 : details.typecheck.errorCount;
  return (
    <ToolCard.Root aria-label={t('card.label', { name: details.name })}>
      <ToolCard.Body scroll="none" className="flex flex-col gap-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          {/* Details recorded before build revisions carry only the version, their revision. */}
          <AppIcon appId={details.appId} revision={details.revision ?? details.version} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={details.name}>
                {details.name}
              </span>
              <Badge variant="outline">
                {details.updated
                  ? t('card.versionUpdated', { version: details.version })
                  : t('card.version', { version: details.version })}
              </Badge>
              {details.widgets > 0 && (
                <Badge variant="secondary">
                  <LayoutDashboard data-icon="inline-start" />
                  {t('card.widgets', { count: details.widgets })}
                </Badge>
              )}
            </div>
            {details.summary && (
              <p className="m-0 line-clamp-2 text-xs text-muted-foreground">{details.summary}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={!available}
            aria-disabled={busy || undefined}
            onClick={() => void actions.open(details.appId)}
          >
            <SquareArrowOutUpRight data-icon="inline-start" />
            {t('card.open')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!available}
            aria-disabled={busy || undefined}
            onClick={() => void actions.showInSettings(details.appId)}
          >
            <History data-icon="inline-start" />
            {t('card.history')}
          </Button>
        </div>
      </ToolCard.Body>
      {errors > 0 && (
        <ToolCard.Footer tone="warning" className="wrap-anywhere">
          {t('card.typecheckWarning', { count: errors })}
        </ToolCard.Footer>
      )}
    </ToolCard.Root>
  );
}
