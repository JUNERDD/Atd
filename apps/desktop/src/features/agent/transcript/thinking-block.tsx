import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { CollapsibleRow } from './collapsible-row';
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
  const icon = <Sparkles className="row-icon" strokeWidth={1.75} />;
  if (block.redacted) {
    // No trigger to expand, but the icon keeps the text edge aligned with the other rows.
    return (
      <div aria-label={summary} className="thinking-row text-sm text-muted-foreground">
        <span className="flex items-center gap-2 px-1.5 py-1">
          {icon}
          <span className="thinking-line">{summary}</span>
        </span>
      </div>
    );
  }
  return (
    <CollapsibleRow
      open={open}
      onOpenChange={setOpen}
      label={open ? t('thinking.title') : `${t('thinking.title')}: ${summary}`}
      icon={icon}
      heading={
        <span
          className={`thinking-line${block.streaming ? ' thinking-pulse' : ''}`}
          title={summary}
        >
          {summary}
        </span>
      }
      className="flex min-w-0 flex-col"
    >
      <div className="thinking-full">
        <StreamdownMarkdown text={block.text} streaming={block.streaming} />
      </div>
    </CollapsibleRow>
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
