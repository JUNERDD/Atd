import { useState } from 'react';
import type {
  ComputerCaptureConsentResult,
  ComputerShellState,
} from '../../client/computer-contract';
import { showErrorToast } from '../../components/toast-store';
import { computerBridge } from './use-computer';

/**
 * Where screen capture for this app build stands, as the Screen access row shows it:
 * `notPrepared` while the shell holds no record; `preparing` while the shell captures and macOS
 * may be asking; `prepared` with when it succeeded (the shell's record, or the answer until the
 * shell's next state reports that record); `failed` after an attempt macOS refused (`denied`) or
 * the shell could not make (`unavailable`), until the next attempt.
 */
export type CaptureConsentView =
  | { phase: 'notPrepared' }
  | { phase: 'preparing' }
  | { phase: 'prepared'; primedAt: string }
  | { phase: 'failed'; reason: 'denied' | 'unavailable' };

/**
 * Preparing screen capture from Settings: what the row shows and the one action that prepares it
 * (`computer.primeCaptureConsent`), which only the person's click sends, so macOS asks here and
 * never in the middle of a task. A call the shell rejects says why in a toast, as other settings
 * actions do, and leaves the row as it was.
 */
export function useCaptureConsent(shell: ComputerShellState) {
  const bridge = computerBridge();
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<ComputerCaptureConsentResult | null>(null);

  async function prepare() {
    if (!bridge || pending) return;
    setPending(true);
    setAnswer(null);
    try {
      setAnswer(await bridge.primeCaptureConsent());
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(false);
    }
  }

  const view = viewOf(pending, answer, shell.captureConsent?.primedAt);
  return { view, prepare, available: Boolean(bridge) };
}

function viewOf(
  pending: boolean,
  answer: ComputerCaptureConsentResult | null,
  recorded: string | undefined,
): CaptureConsentView {
  if (pending) return { phase: 'preparing' };
  if (answer && answer.state !== 'prepared') return { phase: 'failed', reason: answer.state };
  const primedAt = recorded ?? answer?.primedAt;
  return primedAt ? { phase: 'prepared', primedAt } : { phase: 'notPrepared' };
}
