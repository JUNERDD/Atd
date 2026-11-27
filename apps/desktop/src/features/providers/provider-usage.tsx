import { useTranslation } from 'react-i18next';
import { RefreshCw, Wallet } from 'lucide-react';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { Progress } from '@atd/ui/components/progress';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { cn } from '@atd/ui/lib/utils';
import type { Connection, ProviderUsage } from '../../client/providers/schema';
import { ManageChatGPTUsage } from './chatgpt-plan';
import {
  WINDOW_LABELS,
  WINDOW_SHORT_LABELS,
  balanceText,
  money,
  percent,
  resetIn,
  soonestReset,
} from './provider-usage-format';
import {
  isChatGPTConnection,
  providerUsageAvailable,
  usageUnavailableKey,
  useProviderUsage,
} from './use-provider-usage';

/**
 * A compact allowance badge for a connection row or the model picker. It stays out of the way
 * until the provider reports something: unsupported providers, failures, and connections without
 * a credential show no invented numbers.
 */
export function ProviderUsageSummary({
  connection,
  variant = 'inline',
  enabled = true,
}: {
  connection: Connection;
  variant?: 'inline' | 'menu';
  enabled?: boolean;
}) {
  const { t, i18n } = useTranslation('providers');
  const { data, statusesReady } = useProviderUsage(connection, enabled);
  // A disabled query can still retain a cached value; the gate must hide it when the credential,
  // the status probe or the connection no longer allows a usage read.
  if (!enabled || !statusesReady || !providerUsageAvailable(connection) || data?.kind !== 'ok')
    return null;
  const short = data.windows
    .map((window) => `${t(WINDOW_SHORT_LABELS[window.id])} ${percent(window.usedRatio)}`)
    .join(' · ');
  const full = data.windows
    .map((window) => `${t(WINDOW_LABELS[window.id])} ${percent(window.usedRatio)}`)
    .join(' · ');
  const balance = data.balance
    ? t('connections.usage.balanceWith', {
        amount: balanceText(data.balance, i18n.language),
      })
    : null;
  const summary = [short, balance].filter(Boolean).join(' · ');
  if (!summary) return null;
  const reset = soonestReset(data.windows);
  const resetLabel = reset ? resetIn(reset.resetsAt, i18n.language) : null;
  const resetText = resetLabel ? t('connections.usage.resetsIn', { time: resetLabel }) : undefined;
  const title = [[full, balance].filter(Boolean).join(' · '), resetText].filter(Boolean).join('\n');
  if (variant === 'menu')
    return (
      <div className="flex flex-col gap-0.5 px-2 py-1 text-xs text-muted-foreground">
        <span>{summary}</span>
        {resetText && <span>{resetText}</span>}
      </div>
    );
  if (data.windows.length) {
    const high = data.windows.some((window) => window.usedRatio >= 0.9);
    const ratio = data.windows.reduce((max, window) => Math.max(max, window.usedRatio), 0);
    return (
      <Badge variant="outline" className="font-normal" aria-label={title}>
        <ProviderUsageRing ratio={ratio} high={high} />
        <span className={high ? 'text-destructive' : undefined}>{short}</span>
      </Badge>
    );
  }
  if (data.balance)
    return (
      <Badge variant="outline" className="font-normal" aria-label={title}>
        <Wallet aria-hidden className="size-3" />
        {t('connections.usage.balanceWith', {
          amount: balanceText(data.balance, i18n.language),
        })}
      </Badge>
    );
  return null;
}

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** A 12px ring for the row: the badge's SVG sizing keeps it beside one short label. */
function ProviderUsageRing({ ratio, high }: { ratio: number; high: boolean }) {
  const offset = RING_CIRCUMFERENCE * (1 - Math.min(Math.max(ratio, 0), 1));
  return (
    <svg
      viewBox="0 0 16 16"
      className={high ? 'shrink-0 text-destructive' : 'shrink-0 text-muted-foreground'}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
      />
      <circle
        cx="8"
        cy="8"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

/** The full allowance and balance dialog for one connection, with a manual refresh. */
export function ProviderUsageDialog({
  connection,
  onClose,
}: {
  connection: Connection | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('providers');
  const query = useProviderUsage(connection);
  const available = providerUsageAvailable(connection);
  const chatgptConnected = Boolean(
    isChatGPTConnection(connection) && connection?.connected && !connection.credentialIssue,
  );
  const chatgptManaged = chatgptConnected && Boolean(connection?.chatgptPlanEnabled);
  const chatgptPlanDisabled = chatgptConnected && !connection?.chatgptPlanEnabled;
  const usage: ProviderUsage | undefined = available ? query.data : undefined;
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
  const unavailableKey = connection
    ? usageUnavailableKey(connection)
    : 'connections.usage.unavailable';
  const gated = !connection
    ? null
    : !connection.connected || connection.credentialIssue
      ? t(unavailableKey)
      : null;
  return (
    <Dialog
      open={Boolean(connection)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="panel-dialog max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('connections.usage.title', { name: connection?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('connections.usage.description')}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="panel-dialog-scroll" gutter="stable" scrollShadow>
          <div className="panel-dialog-body">
            {gated && <p className="text-sm text-muted-foreground">{gated}</p>}
            {chatgptManaged && (
              <p className="text-sm text-muted-foreground">{t('chatgpt.manageUsageDescription')}</p>
            )}
            {chatgptPlanDisabled && (
              <p className="text-sm text-muted-foreground">
                {t('chatgpt.planDisabledDescription')}
              </p>
            )}
            {showLoading && (
              <p className="text-sm text-muted-foreground">{t('connections.usage.loading')}</p>
            )}
            {pausedForKeychain && (
              <p className="text-sm text-muted-foreground">
                {t('connections.usage.pausedForKeychain')}
              </p>
            )}
            {usage?.kind === 'unsupported' && (
              <p className="text-sm text-muted-foreground">{t('connections.usage.unsupported')}</p>
            )}
            {usage?.kind === 'unavailable' && (
              <p className="text-sm text-muted-foreground">{t(unavailableKey)}</p>
            )}
            {usage?.kind === 'error' && (
              <div className="grid gap-2">
                <p className="text-sm text-destructive">{t('connections.usage.error')}</p>
                <details className="text-xs">
                  <summary className="cursor-pointer">{t('connections.usage.details')}</summary>
                  <p className="mt-2 wrap-anywhere whitespace-pre-wrap">{usage.message}</p>
                </details>
              </div>
            )}
            {available && query.isError && !usage && !query.isFetching && (
              <div className="grid gap-2">
                <p className="text-sm text-destructive">{t('connections.usage.error')}</p>
                <details className="text-xs">
                  <summary className="cursor-pointer">{t('connections.usage.details')}</summary>
                  <p className="mt-2 wrap-anywhere whitespace-pre-wrap">
                    {query.error instanceof Error ? query.error.message : String(query.error)}
                  </p>
                </details>
              </div>
            )}
            {usage?.kind === 'ok' && query.isError && (
              <p className="text-xs text-destructive">{t('connections.usage.refreshFailed')}</p>
            )}
            {usage?.kind === 'ok' &&
              usage.windows.map((window) => {
                const reset = resetIn(window.resetsAt, i18n.language);
                return (
                  <div key={window.id} className="grid gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>{t(WINDOW_LABELS[window.id])}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {percent(window.usedRatio)}
                      </span>
                    </div>
                    <Progress value={window.usedRatio * 100} />
                    {reset && (
                      <p className="text-xs text-muted-foreground">
                        {t('connections.usage.resetsIn', { time: reset })}
                      </p>
                    )}
                  </div>
                );
              })}
            {usage?.kind === 'ok' && usage.balance && (
              <div
                data-slot="usage-balance"
                data-separated={usage.windows.length > 0}
                className={cn(
                  'grid gap-1 text-sm',
                  usage.windows.length > 0 && 'border-t border-border pt-3',
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span>{t('connections.usage.balance')}</span>
                  <span className="tabular-nums">{balanceText(usage.balance, i18n.language)}</span>
                </div>
                {usage.balance.monthlyLimitEnabled &&
                  usage.balance.monthlyLimit !== undefined &&
                  usage.balance.monthlyUsed !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      {t('connections.usage.monthly', {
                        used: money(
                          usage.balance.monthlyUsed,
                          usage.balance.currency,
                          i18n.language,
                        ),
                        limit: money(
                          usage.balance.monthlyLimit,
                          usage.balance.currency,
                          i18n.language,
                        ),
                      })}
                    </p>
                  )}
              </div>
            )}
            {usage?.kind === 'ok' && !usage.windows.length && !usage.balance && (
              <p className="text-sm text-muted-foreground">{t('connections.usage.empty')}</p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          {chatgptManaged ? (
            <ManageChatGPTUsage variant="outline" size="sm" />
          ) : chatgptPlanDisabled ? null : (
            <Button
              variant="outline"
              size="sm"
              disabled={!available || query.isFetching}
              onClick={() => void query.refresh()}
            >
              <RefreshCw />
              {t('connections.usage.retry')}
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            {t('connections.usage.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
