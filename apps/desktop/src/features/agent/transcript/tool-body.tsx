import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { bashCommand } from './tool-copy';

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
    <ScrollArea orientation="both" className="tool-diff" viewportClassName="max-h-[inherit]" gutter>
      <pre className="tool-diff-pre">
        {diff.split('\n').map((line, index) => (
          <DiffLine key={`${index}:${line.slice(0, 24)}`} line={line} />
        ))}
      </pre>
    </ScrollArea>
  );
}

export function ToolOutput({ text }: { text: string }) {
  return (
    <ScrollArea className="tool-output" viewportClassName="max-h-[inherit]" gutter scrollShadow>
      <pre className="tool-output-pre m-0 text-xs leading-4.5 whitespace-pre-wrap wrap-anywhere">
        {text}
      </pre>
    </ScrollArea>
  );
}

export function ToolBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const command = bashCommand(block.args);
  const running = block.status === 'running';
  const text = running ? block.partial : block.output;
  switch (block.name) {
    case 'edit':
      return block.details.diff ? (
        <ToolDiff diff={block.details.diff} />
      ) : (
        <ToolOutput text={text} />
      );
    case 'bash':
      return (
        <div className="tool-bash">
          {command && <pre className="tool-command">{command}</pre>}
          {text && <ToolOutput text={text} />}
        </div>
      );
    default:
      return (
        <>
          {text && <ToolOutput text={text} />}
          {block.status === 'interrupted' && (
            <p className="text-xs text-muted-foreground">{t('activity.interruptedNote')}</p>
          )}
        </>
      );
  }
}
