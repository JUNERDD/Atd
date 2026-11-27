import { useTranslation } from 'react-i18next';
import { Gauge, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Card, CardContent } from '@atd/ui/components/card';
import { Progress } from '@atd/ui/components/progress';
import { Skeleton } from '@atd/ui/components/skeleton';
import { cn } from '@atd/ui/lib/utils';
import {
  CHATGPT_PRIVACY_VERSION,
  type ProviderUsageBalance,
  type ProviderUsageWindow,
} from '@atd/agent-contracts';
import type { Connection } from '../../client/providers/schema';
import { WINDOW_LABELS, balanceText, money, percent, resetIn } from './provider-usage-format';
import { providerUsageAvailable, useProviderUsage } from './use-provider-usage';

/**
 * The connection detail page's allowance section. It makes the provider's real windows and
 * balance visible beside the credential, instead of hiding them behind the row's menu, and names
 * the unsupported or failed state rather than leaving the space blank.
 */
export function ProviderUsagePanel({
  connection,
  dirty = false,
}: {
  connection: Connection;
  dirty?: boolean;
}) {
  const { t, i18n } = useTranslation('providers');
  const query = useProviderUsage(connection);
  const available = providerUsageAvailable(connection);
  const usage = available ? query.data : undefined;
  const showLoading =
    available &&
    !usage &&
    (query.isFetching || (query.isPending && (query.statusesReady || query.settingsLoading)));
  const pausedForKeychain =
    available &&
    !query.statusesReady &&
    !query.settingsLoading &&
    !usage &&
    !query.isFetching &&
    !query.isError;
  const gated = !connection.connected
    ? t('connections.usage.unavailable')
    : !available
      ? connection.credentialIssue
        ? t('connections.usage.unavailable')
        : connection.chatgptConsent?.privacyVersion === CHATGPT_PRIVACY_VERSION
          ? t('chatgpt.planDisabledDescription')
          : t('chatgpt.privacyRequired')
      : null;
  const updated = query.dataUpdatedAt
    ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
        query.dataUpdatedAt,
      )
    : null;
  return (
    <section
      className="settings-fields provider-usage-section"
      aria-labelledby="provider-usage-panel-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <Gauge aria-hidden className="size-4 text-muted-foreground" />
          <h3 id="provider-usage-panel-title" className="settings-section-title">
            {t('connections.usage.sectionTitle')}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {updated && (
            <span className="text-xs text-muted-foreground">
              {t('connections.usage.updated', { time: updated })}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={!available || query.isFetching}
            onClick={() => void query.refresh()}
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />
            {t('connections.usage.retry')}
          </Button>
        </div>
      </div>
      <Card size="sm" className="provider-usage-card">
        <CardContent className="grid gap-4">
          {gated && <p className="text-sm text-muted-foreground">{gated}</p>}
          {showLoading && <UsageSkeleton />}
          {pausedForKeychain && (
            <p className="text-sm text-muted-foreground">
              {t('connections.usage.pausedForKeychain')}
            </p>
          )}
          {usage?.kind === 'unsupported' && (
            <p className="text-sm text-muted-foreground">{t('connections.usage.unsupported')}</p>
          )}
          {usage?.kind === 'unavailable' && (
            <p className="text-sm text-muted-foreground">{t('connections.usage.unavailable')}</p>
          )}
          {usage?.kind === 'error' && <UsageError message={usage.message} />}
          {available && query.isError && !usage && !query.isFetching && (
            <UsageError
              message={query.error instanceof Error ? query.error.message : String(query.error)}
            />
          )}
          {usage?.kind === 'ok' && query.isError && (
            <p className="text-xs text-destructive">{t('connections.usage.refreshFailed')}</p>
          )}
          {usage?.kind === 'ok' && (
            <>
              {usage.windows.length > 0 && (
                <div className="grid gap-5 sm:grid-cols-2">
                  {usage.windows.map((window) => (
                    <UsageWindow key={window.id} window={window} language={i18n.language} />
                  ))}
                </div>
              )}
              {usage.balance && (
                <UsageBalance
                  balance={usage.balance}
                  language={i18n.language}
                  separated={usage.windows.length > 0}
                />
              )}
              {!usage.windows.length && !usage.balance && (
                <p className="text-sm text-muted-foreground">{t('connections.usage.empty')}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {dirty && <p className="settings-field-note">{t('connections.usage.saveFirst')}</p>}
    </section>
  );
}

function UsageWindow({ window, language }: { window: ProviderUsageWindow; language: string }) {
  const { t } = useTranslation('providers');
  const reset = resetIn(window.resetsAt, language);
  const tone = window.usedRatio >= 0.9 ? 'text-destructive' : 'text-muted-foreground';
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{t(WINDOW_LABELS[window.id])}</span>
        <span className={cn('font-medium tabular-nums', tone)}>{percent(window.usedRatio)}</span>
      </div>
      <Progress value={window.usedRatio * 100} />
      {reset && (
        <p className="text-xs text-muted-foreground">
          {t('connections.usage.resetsIn', { time: reset })}
        </p>
      )}
    </div>
  );
}

function UsageBalance({
  balance,
  language,
  separated,
}: {
  balance: ProviderUsageBalance;
  language: string;
  separated: boolean;
}) {
  const { t } = useTranslation('providers');
  return (
    <div
      data-slot="usage-balance"
      data-separated={separated}
      className={cn('grid gap-1 text-sm', separated && 'border-t border-border pt-4')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span>{t('connections.usage.balance')}</span>
        <span className="font-medium tabular-nums">{balanceText(balance, language)}</span>
      </div>
      {balance.monthlyLimitEnabled &&
        balance.monthlyLimit !== undefined &&
        balance.monthlyUsed !== undefined && (
          <p className="text-xs text-muted-foreground">
            {t('connections.usage.monthly', {
              used: money(balance.monthlyUsed, balance.currency, language),
              limit: money(balance.monthlyLimit, balance.currency, language),
            })}
          </p>
        )}
    </div>
  );
}

function UsageError({ message }: { message: string }) {
  const { t } = useTranslation('providers');
  return (
    <div className="flex items-start gap-2 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-1">
        <span>{t('connections.usage.error')}</span>
        <details className="text-xs font-normal text-muted-foreground">
          <summary className="cursor-pointer">{t('connections.usage.details')}</summary>
          <p className="mt-1 wrap-anywhere whitespace-pre-wrap">{message}</p>
        </details>
      </div>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden>
      {[0, 1].map((index) => (
        <div key={index} className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}
