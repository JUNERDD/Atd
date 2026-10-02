import { useTranslation } from 'react-i18next';
import type { PermissionOutcome } from '../../../client/agent/permission-schema';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { hasToolDetail, outcomeKey, structuredDetails, type RowDetails } from './tool-copy';
import { BashBody } from './bash-body';
import { CodemodeBody } from './codemode-body';
import { EditBody } from './edit-body';
import { ReadBody, WriteBody } from './file-bodies';
import { GenericBody } from './generic-body';
import { SearchBody } from './search-bodies';
import { ToolCard } from './tool-card';
import { WebFetchBody, WebSearchBody } from './web-body';

/** A codemode script's output: monospace, wrapping, with the copy action on the card's corner. */
function ScriptOutput({ text }: { text: string }) {
  return (
    <ToolCard.Root>
      <ToolCard.Body copyText={text} className="font-mono">
        <pre className="m-0 wrap-anywhere whitespace-pre-wrap text-muted-foreground">{text}</pre>
      </ToolCard.Body>
    </ToolCard.Root>
  );
}

/**
 * Structured result of a call (`details.data`, validated at the main boundary): settled calls,
 * and a `codemode` call in any status. The model-facing output stays the copy text so the box
 * copies what the agent actually read.
 */
function DetailsBody({ block, data }: { block: BlockOf<'tool'>; data: RowDetails }) {
  const { t } = useTranslation('tasks');
  switch (data.type) {
    case 'codemode': {
      const text = block.status === 'running' ? block.partial : block.output;
      return (
        <>
          <CodemodeBody block={block} data={data} />
          {text && <ScriptOutput text={text} />}
          {block.status === 'interrupted' && (
            <p className="m-0 text-xs text-muted-foreground">{t('activity.interruptedNote')}</p>
          )}
        </>
      );
    }
    case 'webSearch':
      return <WebSearchBody details={data} copyText={block.output} />;
    case 'webFetch':
      return <WebFetchBody details={data} copyText={block.output} />;
    case 'diff':
      // The projection moves the edit diff into `details.diff`; a stray variant reads the same.
      return <EditBody block={block} diff={data.diff} truncated={data.truncated} />;
    default: {
      const _exhaustive: never = data;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * The expanded detail of one call, by tool family: structured results first (codemode, web,
 * diff), then the tool's own body. Each family module owns its card layout; tools without one read
 * through the generic body.
 */
export function ToolBody({ block }: { block: BlockOf<'tool'> }) {
  if (!hasToolDetail(block)) return null;
  const data = structuredDetails(block);
  if (data) return <DetailsBody block={block} data={data} />;
  switch (block.name) {
    case 'edit':
      return block.details.diff ? (
        <EditBody block={block} diff={block.details.diff} truncated={block.details.truncated} />
      ) : (
        <GenericBody block={block} />
      );
    case 'bash':
      return <BashBody block={block} />;
    case 'read':
      return <ReadBody block={block} />;
    case 'write':
      return <WriteBody block={block} />;
    case 'grep':
    case 'find':
    case 'ls':
      return <SearchBody block={block} />;
    default:
      return <GenericBody block={block} />;
  }
}

/**
 * The call's recorded permission outcome, last in its detail. The row itself shows only a
 * decline, so this line is where every approval reads.
 */
export function PermissionNote({ outcome }: { outcome: PermissionOutcome }) {
  const { t } = useTranslation('tasks');
  return (
    <p className="m-0 text-xs text-muted-foreground">
      {t('permission.detail', { outcome: t(outcomeKey(outcome)) })}
    </p>
  );
}
