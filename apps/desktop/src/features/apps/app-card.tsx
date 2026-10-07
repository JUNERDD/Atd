import { History, LayoutDashboard, SquareArrowOutUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppBuildDetails } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { ToolCard } from '../agent/transcript/tool-card';
import { AppIcon } from './app-icon';
import { useAppActions } from './use-app-actions';

/**
 * Where an `app.build` call stands: still building, failed (its row's output carries the error),
 * or published, with or without type errors.
 */
export type AppCardState = 'building' | 'failed' | 'ready';

/**
 * The app an `app.build` call published (Figma `App / App card`), shown under its tool row as of
 * that build: the icon, name, version and widget count, the build's change note, then Open and
 * Version history. A later build of the same run updates the version an earlier one published,
 * so its badge says the version was updated rather than naming it as if it were new. Type errors
 * that did not stop the build read as a warning footer; a build still running shows its progress
 * instead of actions, and a failed one its error, with actions that open the last version that
 * built.
 */
export function AppCard({
  details,
  state,
  error,
}: {
  details: AppBuildDetails;
  state: AppCardState;
  /** The failed build's error, from the row's output. */
  error?: string;
}) {
  const { t } = useTranslation('apps');
  const actions = useAppActions();
  const busy = actions.busy.has(details.appId);
  const available = Boolean(window.desktop?.apps);
  const errors = details.typecheck.ok ? 0 : details.typecheck.errorCount;
  const footer =
    state === 'building'
      ? { tone: 'muted' as const, text: t('card.building', { version: details.version }) }
      : state === 'failed'
        ? { tone: 'destructive' as const, text: error || t('card.failed') }
        : errors > 0
          ? { tone: 'warning' as const, text: t('card.typecheckWarning', { count: errors }) }
          : null;
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
        {state !== 'building' && (
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
        )}
      </ToolCard.Body>
      {footer && (
        <ToolCard.Footer tone={footer.tone} className="wrap-anywhere">
          {footer.text}
        </ToolCard.Footer>
      )}
    </ToolCard.Root>
  );
}
