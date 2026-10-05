import { useState } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppVersion } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@atd/ui/components/item';
import { Spinner } from '@atd/ui/components/spinner';
import { AppDetailSection, AppDetailStatusRow } from './app-detail-group';
import type { AppIntent } from './use-app-intent';

/** Versions listed before Show all: the newest few, which a revert usually goes back to. */
const PREVIEW_COUNT = 5;

/**
 * One kept version (Figma `App / App version row`): its number, Current on the version that runs,
 * the build's change note, and when it was built with how its type check went. Revert publishes
 * it again as the newest version, after a confirmation that the data stays as it is; the current
 * version has nothing to revert to, and the other rows keep Revert at the trailing edge.
 */
function AppVersionRow({
  version,
  current,
  busy,
  reverting,
  onRevert,
}: {
  version: AppVersion;
  current: boolean;
  busy: boolean;
  reverting: boolean;
  onRevert: () => void;
}) {
  const { t, i18n } = useTranslation('apps');
  const built = new Date(version.createdAt).toLocaleString(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const check = version.typecheck.ok
    ? t('detail.versions.typecheckPassed')
    : t('detail.versions.typeErrors', { count: version.typecheck.errorCount });
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li aria-busy={reverting || undefined}>
        <ItemContent className="min-w-[min(120px,100%)]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <ItemTitle>{t('detail.versions.item', { version: version.n })}</ItemTitle>
            {current && <Badge variant="secondary">{t('detail.versions.current')}</Badge>}
          </div>
          {version.summary && (
            <ItemDescription className="line-clamp-2 whitespace-normal">
              {version.summary}
            </ItemDescription>
          )}
          <p className="app-detail-meta">
            {!version.typecheck.ok && (
              <TriangleAlert aria-hidden="true" className="app-detail-warning-icon" />
            )}
            <span>{t('detail.versions.meta', { date: built, check })}</span>
          </p>
        </ItemContent>
        {!current && (
          <ItemActions className="ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('detail.versions.revertLabel', { version: version.n })}
              aria-disabled={busy || undefined}
              aria-busy={reverting || undefined}
              onClick={onRevert}
            >
              {reverting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCcw data-icon="inline-start" />
              )}
              {reverting ? t('detail.versions.reverting') : t('detail.versions.revert')}
            </Button>
          </ItemActions>
        )}
      </li>
    </Item>
  );
}

/**
 * The app's kept versions, newest first. A long history shows the newest few, with Show all in
 * the group's title row; the rows load in place, and a failed read offers Try again there.
 */
export function AppVersionsSection({
  versions,
  error,
  onRetry,
  current,
  busy,
  pending,
  onRevert,
}: {
  /** Null until the first read answers. */
  versions: AppVersion[] | null;
  error: string | null;
  onRetry: () => void;
  current: number;
  busy: boolean;
  pending: AppIntent | null;
  onRevert: (version: number) => void;
}) {
  const { t } = useTranslation('apps');
  const [expanded, setExpanded] = useState(false);
  const collapsible = versions !== null && versions.length > PREVIEW_COUNT;
  const shown = collapsible && !expanded ? versions.slice(0, PREVIEW_COUNT) : versions;
  return (
    <AppDetailSection
      title={t('detail.versions.title')}
      footer={t('detail.versions.footer')}
      action={
        collapsible && (
          <Button
            type="button"
            variant="link"
            size="xs"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? t('detail.versions.showFewer')
              : t('detail.versions.showAll', { total: versions.length })}
          </Button>
        )
      }
    >
      {shown ? (
        shown.map((version) => (
          <AppVersionRow
            key={version.n}
            version={version}
            current={version.n === current}
            busy={busy}
            reverting={pending === `revert:${version.n}`}
            onRevert={() => onRevert(version.n)}
          />
        ))
      ) : (
        <AppDetailStatusRow error={error} onRetry={onRetry} />
      )}
    </AppDetailSection>
  );
}
