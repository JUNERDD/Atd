import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';
import { useMemoryCreate } from './use-memory-create';

/**
 * The Memory section's Create-with-AI button (`useMemoryCreate`). While learning is paused the
 * agent cannot save memories, so the button waits for learning to resume and says why meanwhile.
 */
export function MemoryCreateButton({
  paused,
  unavailable,
}: {
  /** Automatic learning is paused, so the agent cannot write memories. */
  paused: boolean;
  /** Memory has not loaded, or failed to. */
  unavailable: boolean;
}) {
  const { t } = useTranslation('memory');
  const { starting, start } = useMemoryCreate();
  const button = (
    <Button
      disabled={unavailable || starting}
      // Paused stays focusable and hoverable, unlike `disabled`, so its tooltip can say why.
      aria-disabled={paused || undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (!paused) start(false);
      }}
    >
      <Sparkles data-icon="inline-start" />
      {t('memory.create.label')}
    </Button>
  );
  if (!paused) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{t('memory.create.pausedHint')}</TooltipContent>
    </Tooltip>
  );
}
