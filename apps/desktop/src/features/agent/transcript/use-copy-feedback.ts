import { useEffect, useRef, useState } from 'react';
import { showErrorToast } from '../../../components/toast-store';
import { agentApi } from '../use-agent';

const COPIED_DURATION_MS = 1_000;

/**
 * Copies text to the pasteboard with brief feedback: `copied` swaps the button's icon and label,
 * and `pinned` holds its tooltip open until the pointer leaves (`unpin`) or the feedback ends.
 */
export function useCopyFeedback() {
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(text: string) {
    try {
      await agentApi().copy(text);
      setCopied(true);
      setPinned(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
        setPinned(false);
      }, COPIED_DURATION_MS);
    } catch (error) {
      showErrorToast(error);
      setCopied(false);
      setPinned(false);
    }
  }

  return { copied, pinned, unpin: () => setPinned(false), copy };
}
