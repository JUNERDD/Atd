import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { bashCommand, hasToolDetail } from './tool-copy';
import { DetailBox } from './detail-box';
import { Root as JsonTree } from './json-tree';

function DiffLine({ line }: { line: string }) {
  const kind =
    line.startsWith('+') && !line.startsWith('+++')
      ? 'add'
      : line.startsWith('-') && !line.startsWith('---')
        ? 'del'
        : line.startsWith('@@')
          ? 'hunk'
          : '';
  return <div className={kind ? `diff-line diff-${kind}` : 'diff-line'}>{line || ' '}</div>;
}

export function ToolDiff({ diff }: { diff: string }) {
  return (
    <DetailBox variant="diff" copyText={diff}>
      <div>
        {diff.split('\n').map((line, index) => (
          <DiffLine key={`${index}:${line.slice(0, 24)}`} line={line} />
        ))}
      </div>
    </DetailBox>
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
      {text && <pre className="m-0 whitespace-pre-wrap wrap-anywhere">{text}</pre>}
    </DetailBox>
  );
}

export function ToolBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const command = bashCommand(block.args);
  const running = block.status === 'running';
  const text = running ? block.partial : block.output;
  if (!hasToolDetail(block)) return null;
  switch (block.name) {
    case 'edit':
      return block.details.diff ? (
        <ToolDiff diff={block.details.diff} />
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
