import { useEffect, useRef } from 'react';
import type { ArgumentValues } from '../../client/agent/command-schema';

/** How long a typed parameter value waits for the next keystroke before it is remembered. */
const REMEMBER_DELAY_MS = 400;

/**
 * Remembers the parameter values the command input step shows (`values`) as where command
 * `commandId`'s next run starts, as the person changes them, whether or not they run it. Only the
 * parameters: the text, files and screenshot the run works on are never remembered. The values the
 * step opened with are no change. A value typed a character at a time waits `REMEMBER_DELAY_MS`
 * for the next one; leaving the step remembers a change still waiting at once. A step launched
 * from one of the command's shortcuts (`shortcutId`) names it, so the keys it pins keep what was
 * remembered for them.
 */
export function useRememberedArguments(
  commandId: string,
  values: ArgumentValues,
  shortcutId?: string,
): void {
  const shown = useRef(values);
  const waiting = useRef<ArgumentValues | null>(null);

  useEffect(() => {
    if (values === shown.current) return;
    shown.current = values;
    waiting.current = values;
    const timer = setTimeout(() => remember(commandId, shortcutId, waiting), REMEMBER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [commandId, shortcutId, values]);

  useEffect(() => () => remember(commandId, shortcutId, waiting), [commandId, shortcutId]);
}

/** Sends the values still waiting, if any. */
function remember(
  commandId: string,
  shortcutId: string | undefined,
  waiting: { current: ArgumentValues | null },
): void {
  const values = waiting.current;
  if (!values) return;
  waiting.current = null;
  window.desktop?.agent
    ?.rememberArguments?.(commandId, values, shortcutId)
    .catch((error: unknown) => {
      console.error('The command input values were not remembered:', error);
    });
}
