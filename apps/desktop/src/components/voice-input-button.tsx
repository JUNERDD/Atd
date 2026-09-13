import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';

const FEEDBACK_DURATION_MS = 3_000;
const FEEDBACK_MESSAGE = 'Voice input unavailable';

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
  const { open, feedback, show, dismiss, onOpenChange } = useVoiceFeedback();

  return (
    <>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Voice input"
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
          {feedback ? FEEDBACK_MESSAGE : 'Voice input'}
        </TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {feedback ? FEEDBACK_MESSAGE : ''}
      </span>
    </>
  );
}
