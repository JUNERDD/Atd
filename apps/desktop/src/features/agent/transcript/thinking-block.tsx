import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { StreamdownMarkdown } from './markdown';
import { proseSummary } from './phases';

/**
 * Single-line reasoning row (plan T2). In a phase the rail is the bullet, so the row drops its
 * own icon and the line itself breathes while reasoning streams in. Opening the fold around it
 * does not open the thought — reasoning is only ever read on purpose, one line until asked for.
 */
export function ThinkingBlock({ block }: { block: BlockOf<'thinking'> }) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const summary = block.redacted
    ? t('thinking.redacted')
    : proseSummary(block.text) ||
      t(block.streaming ? 'transcript.verb.thinkLive' : 'transcript.verb.thinkDone');
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

/** A line the agent wrote mid-run, kept to one line. It opens on click, so folding the work never costs a paragraph wanted for reading. */
export function NoteBlock({ block }: { block: BlockOf<'assistant'> }) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const summary = proseSummary(block.text) || t('transcript.verb.working');
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex min-w-0 flex-col">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="activity-trigger"
          aria-label={open ? t('transcript.verb.working') : summary}
        >
          <span className="note-line" title={summary}>
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
