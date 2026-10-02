import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ToolCard } from './tool-card';
import './tool-list.css';

/**
 * The card shared by `grep`, `find`, and `ls`: a header naming what was searched with its tally,
 * the results, then Pi's closing notice (limits reached, lines cut) and the interrupted note as
 * footers. The header copies `text`, the text the agent read (live output while running).
 */
export function SearchFrame({
  block,
  text,
  icon,
  label,
  meta,
  notice,
  children,
}: {
  block: BlockOf<'tool'>;
  text: string;
  icon: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  notice?: string | null;
  children?: ReactNode;
}) {
  const { t } = useTranslation('tasks');
  return (
    <ToolCard.Root>
      <ToolCard.Header icon={icon} label={label} meta={meta} copyText={text} />
      {children && <ToolCard.Body size="lg">{children}</ToolCard.Body>}
      {notice && <ToolCard.Footer>{notice}</ToolCard.Footer>}
      {block.status === 'interrupted' && (
        <ToolCard.Footer>{t('activity.interruptedNote')}</ToolCard.Footer>
      )}
    </ToolCard.Root>
  );
}

/** A result that did not parse (or an error): the text as the agent read it, in monospace. */
export function PlainResult({ text }: { text: string }) {
  return <pre className="tool-list-plain font-mono">{text}</pre>;
}

/** The calm line a search with no results shows in place of a list. */
export function EmptyResult({ children }: { children: ReactNode }) {
  return <p className="tool-list-empty">{children}</p>;
}
