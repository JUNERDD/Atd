import type { Logger } from '../logging.js';

/**
 * How memory changes are announced: the authority's events (store notices, run-made changes) and
 * the per-agentDir listeners of changes made off the HTTP routes.
 */

/** What the memory authority reports: store notices, and changes made off the HTTP routes. */
export interface MemoryAuthorityEvents {
  notify: (message: string, kind: 'info' | 'warning' | 'error') => void;
  changed: () => void;
}

/**
 * Service-level authority events: store notices and run-made changes land in the service log. The
 * authority is a per-agentDir singleton, so the first caller's events serve every caller.
 */
export function logMemoryEvents(log: Logger): MemoryAuthorityEvents {
  return {
    notify: (message, kind) => {
      if (kind === 'error') log.error('Memory notice.', { message });
      else if (kind === 'warning') log.warn('Memory notice.', { message });
      else log.info('Memory notice.', { message });
    },
    changed: () => log.debug('Memory store changed.'),
  };
}

const watchers = new Map<string, Set<() => void>>();

/**
 * Calls `listener` whenever memory of `agentDir` changes off the HTTP routes: a tool write, a
 * learner commit or a consolidation. The server announces route writes itself, so this is how
 * clients hear about the others. Answers the unsubscribe.
 */
export function watchMemory(agentDir: string, listener: () => void): () => void {
  const listeners = watchers.get(agentDir) ?? new Set();
  listeners.add(listener);
  watchers.set(agentDir, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) watchers.delete(agentDir);
  };
}

/** Tells the listeners of `agentDir` that its memory changed off the routes. */
export function announceMemoryChange(agentDir: string): void {
  for (const listener of watchers.get(agentDir) ?? []) listener();
}
