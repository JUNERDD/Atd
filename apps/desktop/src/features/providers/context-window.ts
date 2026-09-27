/**
 * A token count like pi's footer prints it: thousands with lowercase k and millions with
 * uppercase M, trailing zeros trimmed (`1.5k`, `272k`, `1M`). Millions keep two decimals below
 * ten so neighbouring windows stay distinct (`1.05M`, not `1.1M`).
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(Math.max(0, Math.round(count)));
  const trim = (value: number, digits: number): string =>
    value.toFixed(digits).replace(/\.?0+$/, '');
  if (count < 10_000) return `${trim(count / 1000, 1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${trim(count / 1_000_000, 2)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/** A context window size; unknown or non-positive windows show an em dash. */
export function formatContextWindow(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count) || count <= 0) return '—';
  return formatTokenCount(count);
}
