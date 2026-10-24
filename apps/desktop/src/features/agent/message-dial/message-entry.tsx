import { useMemo, useRef, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@atd/ui/components/popover';
import { useConversationControls } from '../transcript/conversation-controls';
import { MessageDial, type DialHandle } from './message-dial';

/**
 * The composer's way through the conversation's user messages: a button with their count that
 * opens the message dial above the composer surface, as wide as it and never over the draft. It
 * shows only while the conversation on screen is this composer's task (`taskId`) and has more than
 * one message. The dial opens on a click and closes on Escape (back where the reader was), Enter
 * or a click outside (where the dial stands). It opens a popup, so it has no tooltip.
 */
export function MessageEntry({ taskId }: { taskId: string | null }) {
  const { t } = useTranslation('tasks');
  const controls = useConversationControls();
  const [open, setOpen] = useState(false);
  // The trigger is held as state, not read through a ref captured at mount: Strict Mode's double
  // render keeps the first render's memos but attaches the element to the second's ref.
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const dial = useRef<DialHandle>(null);
  // The popover rests on the composer surface of the form this entry sits in. A new reference per
  // trigger makes Radix measure the one now in the document.
  const surface = useMemo(
    () => ({ current: { getBoundingClientRect: () => surfaceRect(trigger) } }),
    [trigger],
  );
  const shown =
    controls !== null &&
    taskId !== null &&
    controls.taskId === taskId &&
    controls.prompts.length > 1;
  // Hidden while open (another view, or the conversation went away), it reopens closed.
  if (!shown && open) setOpen(false);
  if (!shown) return null;
  const count = controls.prompts.length;

  function close() {
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor virtualRef={surface} />
      <PopoverTrigger asChild>
        <Button
          ref={setTrigger}
          type="button"
          variant="glass-ghost"
          size="xs"
          aria-label={t('transcript.prompts.label', { count })}
        >
          {/* Sized and nudged like the permission control's icon beside it: the xs button's default
              size, dropped 1px to meet the label's optical baseline. */}
          <MessageSquareText className="translate-y-px" />
          <span className="text-muted-foreground tabular-nums">{count}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        // Turned away from a short window it would cover the draft; it stays above instead.
        avoidCollisions={false}
        material="backdrop"
        className="message-dial-popover"
        aria-label={t('transcript.prompts.listLabel')}
        // The dial takes focus itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          // Handled here, so the panel's own Escape does not also step back.
          event.preventDefault();
          dial.current?.goBack();
          close();
        }}
        onInteractOutside={() => dial.current?.keep()}
      >
        <MessageDial controls={controls} handle={dial} onDone={close} />
      </PopoverContent>
    </Popover>
  );
}

/** The composer surface in `trigger`'s form, measured when the popover places itself. */
function surfaceRect(trigger: HTMLElement | null): DOMRect {
  const target = trigger?.closest('.composer')?.querySelector('.composer-surface') ?? trigger;
  return target?.getBoundingClientRect() ?? new DOMRect();
}
