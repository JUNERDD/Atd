import { useEffect, useEffectEvent } from 'react';
import { showErrorToast } from '../../components/toast-store';
import { agentApi } from './use-agent';

/**
 * The selection toolbar's Ask Atd, which the shell hands to the panel page after it captured the
 * selection and showed the panel. The page takes the capture and quotes it into the draft through
 * `quote`, the transcript's Quote in reply path (a chip after the draft's content, then the
 * composer focused), and `showComposer` leaves a view that has none or covers it. Nothing is sent.
 * A failed or empty capture shows its error and leaves the draft alone.
 */
export function useSelectionAsk({
  quote,
  showComposer,
}: {
  quote: (markdown: string) => void;
  showComposer: () => void;
}): void {
  const ask = useEffectEvent(async () => {
    let text: string;
    try {
      ({ text } = await agentApi().capture('selection'));
    } catch (error) {
      showErrorToast(error);
      return;
    }
    quote(text);
    showComposer();
  });
  useEffect(() => window.desktop?.onSelectionAsk?.(() => void ask()), []);
}
