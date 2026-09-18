import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { formatElapsed } from './elapsed';
import { StreamdownMarkdown } from './markdown';

/**
 * Single-line reasoning row showing `Thought 5s` once settled; live keeps the breathing
 * `Thinking` line. Reasoning is only ever read on purpose by opening the row.
 */
export function ThinkingBlock({ block }: { block: BlockOf<'thinking'> }) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const elapsed = block.durationMs == null ? null : formatElapsed(block.durationMs);
  const summary = block.redacted
    ? t('thinking.redacted')
    : block.streaming
      ? t('transcript.verb.thinkLive')
      : elapsed == null
        ? t('transcript.verb.thinkDone')
        : t('thinking.doneWithElapsed', { elapsed });
  if (block.redacted) {
    return (
      <div aria-label={summary} className="thinking-row text-sm text-muted-foreground">
        <span className="thinking-line">{summary}</span>
      </div>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex min-w-0 flex-col">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="activity-trigger"
          aria-label={open ? t('thinking.title') : `${t('thinking.title')}: ${summary}`}
        >
          <span
            className={`thinking-line${block.streaming ? ' thinking-pulse' : ''}`}
            title={summary}
          >
            {summary}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="thinking-full">
          <StreamdownMarkdown text={block.text} streaming={block.streaming} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SystemBlock({ block }: { block: BlockOf<'system'> }) {
  return (
    <p
      className={`system-note text-sm text-muted-foreground${block.level === 'error' ? ' text-destructive' : ''}`}
    >
      {block.text}
    </p>
  );
}
