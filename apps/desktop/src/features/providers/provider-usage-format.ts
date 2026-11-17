import type {
  ProviderUsageBalance,
  ProviderUsageWindow,
  ProviderUsageWindowId,
} from '@atd/agent-contracts';

/** Full labels for the detail views. */
export const WINDOW_LABELS = {
  session: 'connections.usage.windows.session',
  weekly: 'connections.usage.windows.weekly',
  monthly: 'connections.usage.windows.monthly',
  monthlyCode: 'connections.usage.windows.monthlyCode',
} as const satisfies Record<ProviderUsageWindowId, string>;

/** Compact labels for the connection row and the model picker. */
export const WINDOW_SHORT_LABELS = {
  session: 'connections.usage.windows.sessionShort',
  weekly: 'connections.usage.windows.weeklyShort',
  monthly: 'connections.usage.windows.monthlyShort',
  monthlyCode: 'connections.usage.windows.monthlyCodeShort',
} as const satisfies Record<ProviderUsageWindowId, string>;

export function percent(ratio: number): string {
  const value = ratio * 100;
  if (value > 0 && value < 1) return '<1%';
  return `${Math.round(value)}%`;
}

/** A reset time as a short relative phrase, or null when the provider sent none or it has passed. */
export function resetIn(resetsAt: string | undefined, language: string): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (Number.isNaN(at)) return null;
  const minutes = Math.round((at - Date.now()) / 60_000);
  if (minutes <= 0) return null;
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (minutes < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

export function money(value: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function soonestReset(windows: readonly ProviderUsageWindow[]): ProviderUsageWindow | null {
  return (
    windows
      .filter((window) => window.resetsAt)
      .sort((a, b) => Date.parse(a.resetsAt!) - Date.parse(b.resetsAt!))[0] ?? null
  );
}

export function balanceText(balance: ProviderUsageBalance, language: string): string {
  return money(balance.remaining, balance.currency, language);
}
