import { useState } from 'react';
import { Brain, ChevronRight, Terminal, LoaderCircle, CircleAlert } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';
import { Button } from '@ai/ui/components/button';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { MessagePart } from '../../../electron/agent/task-schema';

export function ToolActivity({
  part,
  interrupted,
  waiting,
}: {
  part: Extract<MessagePart, { type: 'tool' }>;
  interrupted: boolean;
  waiting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const memory = part.name.startsWith('memory_');
  const title = memory ? 'Memory' : part.name === 'ask_user' ? 'Your input' : part.name;
  const status = interrupted && part.status === 'running' ? 'interrupted' : part.status;
  const running = status === 'running' && !waiting;
  const statusLabel =
    status === 'completed'
      ? memory && part.name !== 'memory_search'
        ? 'Saved'
        : 'Completed'
      : status === 'running'
        ? waiting
          ? 'Waiting…'
          : memory && part.name !== 'memory_search'
            ? 'Saving…'
            : 'Running…'
        : status === 'failed'
          ? 'Failed'
          : 'Interrupted';
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="tool-activity">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="tool-heading">
          {running ? (
            <LoaderCircle className="motion-safe:animate-spin" />
          ) : status === 'failed' ? (
            <CircleAlert />
          ) : memory ? (
            <Brain />
          ) : (
            <Terminal />
          )}
          <span className="min-w-0 flex-1 truncate text-left" title={title}>
            {running ? (
              <Shimmer as="span" className="block w-fit max-w-full truncate">
                {title}
              </Shimmer>
            ) : (
              title
            )}
          </span>
          <span className="shrink-0 text-xs font-normal whitespace-nowrap text-muted-foreground">
            {running ? <Shimmer as="span">{statusLabel}</Shimmer> : statusLabel}
          </span>
          <ChevronRight className={open ? 'rotate-90' : ''} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-details">
        <ScrollArea className="tool-output" viewportClassName="text-preview-viewport">
          <pre>{part.input}</pre>
        </ScrollArea>
        {part.output && (
          <ScrollArea className="tool-output" viewportClassName="text-preview-viewport">
            <pre>{part.output}</pre>
          </ScrollArea>
        )}
        {status === 'interrupted' && (
          <p>
            Execution ended before a final tool result was recorded. Review any existing file
            changes before continuing.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
