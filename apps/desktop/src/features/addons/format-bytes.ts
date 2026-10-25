const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/**
 * A byte count as the system shows file sizes (decimal units), in the page's language. A size
 * over 10 of its unit drops the fraction, so 98.1 MB and 120 MB both read at a glance.
 */
export function formatBytes(bytes: number, language: string): string {
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1000 && index < UNITS.length - 1) {
    value /= 1000;
    index += 1;
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: UNITS[index],
    unitDisplay: 'short',
    maximumFractionDigits: value >= 10 || index === 0 ? 0 : 1,
  }).format(value);
}
