import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';

const FEEDBACK_DURATION_MS = 3_000;

function useVoiceFeedback() {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function dismiss() {
    clearTimeout(timer.current);
    setFeedback(false);
    setOpen(false);
  }

  function show() {
    clearTimeout(timer.current);
    setFeedback(true);
    setOpen(true);
    timer.current = setTimeout(dismiss, FEEDBACK_DURATION_MS);
  }

  function onOpenChange(nextOpen: boolean) {
    // Pointer leave must not cut short the timed click feedback.
    if (!feedback) setOpen(nextOpen);
  }

  return { open, feedback, show, dismiss, onOpenChange };
}

export function VoiceInputButton() {
  const { t } = useTranslation('panel');
  const { open, feedback, show, dismiss, onOpenChange } = useVoiceFeedback();

  return (
    <>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('voice.label')}
            onClick={show}
          >
            <Mic />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="center"
          sideOffset={4}
          collisionPadding={16}
          onEscapeKeyDown={dismiss}
          onPointerDownOutside={dismiss}
        >
          {feedback ? t('voice.unavailable') : t('voice.label')}
        </TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {feedback ? t('voice.unavailable') : ''}
      </span>
    </>
  );
}
