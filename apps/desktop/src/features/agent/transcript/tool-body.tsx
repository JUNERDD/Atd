import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@ai/ui/lib/utils';
import type { PermissionOutcome } from '../../../client/agent/permission-schema';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import {
  bashCommand,
  hasToolDetail,
  outcomeKey,
  structuredDetails,
  type RowDetails,
} from './tool-copy';
import { CodemodeBody } from './codemode-body';
import { DetailBox } from './detail-box';
import { Root as JsonTree } from './json-tree';
import { WebFetchBody, WebSearchBody } from './web-body';

/** Pi's edit diff marks skipped context with a line holding only padding and `...`. */
const PI_GAP_LINE = /^\s+\.\.\.$/;
/**
 * Pi's display diff embeds the line number after the sign (`+12 text`, ` 12 text`); the sign and
 * number read as a muted gutter so the changed text stands out. Other lines render verbatim.
 */
const PI_NUMBERED_LINE = /^([+\- ] *\d+ ?)(.*)$/;

function DiffText({ line }: { line: string }) {
  const match = PI_NUMBERED_LINE.exec(line);
  if (!match) return line || ' ';
  return (
    <>
      <span className="text-muted-foreground">{match[1]}</span>
      {match[2]}
    </>
  );
}

function DiffLine({ line }: { line: string }) {
  const kind =
    line.startsWith('+') && !line.startsWith('+++')
      ? 'add'
      : line.startsWith('-') && !line.startsWith('---')
        ? 'del'
        : line.startsWith('@@') || PI_GAP_LINE.test(line)
          ? 'hunk'
          : '';
  return (
    <div
      className={cn(
        'diff-line',
        kind === 'add' && 'diff-add',
        kind === 'del' && 'diff-del',
        kind === 'hunk' && 'diff-hunk',
      )}
    >
      <DiffText line={line} />
    </div>
  );
}

/** The diff box; a note below it says when the service shortened the diff to its bound. */
export function ToolDiff({ diff, truncated }: { diff: string; truncated: boolean }) {
  const { t } = useTranslation('tasks');
  return (
    <>
      <DetailBox variant="diff" copyText={diff}>
        <div>
          {diff.split('\n').map((line, index) => (
            <DiffLine key={`${index}:${line.slice(0, 24)}`} line={line} />
          ))}
        </div>
      </DetailBox>
      {truncated && (
        <p className="m-0 text-xs text-muted-foreground">{t('activity.truncatedNote')}</p>
      )}
    </>
  );
}

/**
 * One body, one box: the detail always reads inside a single tinted region. `header` lets bash
 * share this box for its command line instead of standing alone above it.
 */
export function ToolOutput({
  text,
  header,
  kind,
}: {
  text: string;
  header?: ReactNode;
  kind?: ReactNode;
}) {
  return (
    <DetailBox variant="output" copyText={text}>
      {kind}
      {header}
      {text && <pre className="m-0 wrap-anywhere whitespace-pre-wrap">{text}</pre>}
    </DetailBox>
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
          {text && <ToolOutput text={text} />}
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
      return <ToolDiff diff={data.diff} truncated={data.truncated} />;
    default: {
      const _exhaustive: never = data;
      void _exhaustive;
      return null;
    }
  }
}

export function ToolBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const command = bashCommand(block.args);
  const running = block.status === 'running';
  const text = running ? block.partial : block.output;
  if (!hasToolDetail(block)) return null;
  const data = structuredDetails(block);
  if (data) return <DetailsBody block={block} data={data} />;
  switch (block.name) {
    case 'edit':
      return block.details.diff ? (
        <ToolDiff diff={block.details.diff} truncated={block.details.truncated} />
      ) : (
        <ToolOutput text={text} />
      );
    case 'bash': {
      // Only shell executions carry a type badge, and the `Shell` label stays untranslated,
      // matching the technical-term convention.
      const kind = <span className="tool-kind">Shell</span>;
      return (
        <ToolOutput
          text={text}
          kind={kind}
          header={command ? <pre className="tool-command">{command}</pre> : undefined}
        />
      );
    }
    default:
      return (
        <>
          {text && <JsonTree text={text} />}
          {block.status === 'interrupted' && (
            <p className="text-xs text-muted-foreground">{t('activity.interruptedNote')}</p>
          )}
        </>
      );
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
