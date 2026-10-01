import type { ReactNode } from 'react';
import { ScrollArea } from '@ai/ui/components/scroll-area';

/**
 * The user's message bubble. The frame owns the shape, fill and height cap; a long message scrolls
 * inside it, so a pasted document or a resolved command instruction cannot push the conversation
 * out of view.
 */
export function MessageBubble({ children }: { children: ReactNode }) {
  return (
    <ScrollArea
      className="message-bubble-frame"
      viewportClassName="message-bubble-viewport"
      scrollShadow
    >
      <div className="message-bubble">{children}</div>
    </ScrollArea>
  );
}
