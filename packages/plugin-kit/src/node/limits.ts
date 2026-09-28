import type { FetchLimits } from './installer.js';

export const DEFAULT_LIMITS: FetchLimits = { maxBytes: 50 * 1024 * 1024, maxFiles: 5000 };

/** A fetched bundle is larger than the configured limits. */
export class FetchLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchLimitError';
  }
}

/**
 * Running totals for one staging generation. `add` throws once either limit is exceeded, so a
 * fetcher stops copying or extracting as early as it can.
 */
export function createBudget(limits: FetchLimits) {
  let files = 0;
  let bytes = 0;
  return {
    add(size: number): void {
      files += 1;
      bytes += size;
      if (files > limits.maxFiles) {
        throw new FetchLimitError(`The plugin has more than ${limits.maxFiles} files.`);
      }
      if (bytes > limits.maxBytes) {
        throw new FetchLimitError(`The plugin is larger than ${limits.maxBytes} bytes.`);
      }
    },
  };
}
export type Budget = ReturnType<typeof createBudget>;
