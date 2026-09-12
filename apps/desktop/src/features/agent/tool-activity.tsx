import { useState } from 'react';
import { Brain, ChevronRight, Terminal, LoaderCircle, CircleAlert } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';
import { Button } from '@ai/ui/components/button';
import type { MessagePart } from '../../../electron/agent/task-schema';

export function ToolActivity({
  part,
  interrupted,
}: {
  part: Extract<MessagePart, { type: 'tool' }>;
  interrupted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const memory = part.name.startsWith('memory_');
  const status = interrupted && part.status === 'running' ? 'interrupted' : part.status;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="tool-activity">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="tool-heading">
          {status === 'running' ? (
            <LoaderCircle className="animate-spin" />
          ) : status === 'failed' ? (
            <CircleAlert />
          ) : memory ? (
            <Brain />
          ) : (
            <Terminal />
          )}
          <span className="min-w-0 flex-1 text-left">
            {memory ? 'Memory' : part.name === 'ask_user' ? 'Your input' : part.name}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {status === 'completed'
              ? memory && part.name !== 'memory_search'
                ? 'Saved'
                : 'Completed'
              : status === 'running'
                ? memory && part.name !== 'memory_search'
                  ? 'Saving…'
                  : 'Running…'
                : status === 'failed'
                  ? 'Failed'
                  : 'Interrupted'}
          </span>
          <ChevronRight className={open ? 'rotate-90' : ''} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-details">
        <pre>{part.input}</pre>
        {part.output && <pre>{part.output}</pre>}
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
