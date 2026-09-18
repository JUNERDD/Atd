import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { bashCommand } from './tool-copy';

const PREVIEW_LINES = 12;

function truncateLines(text: string): { preview: string; truncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= PREVIEW_LINES) return { preview: text, truncated: false };
  return { preview: lines.slice(0, PREVIEW_LINES).join('\n'), truncated: true };
}

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

export function ToolOutput({ text, live }: { text: string; live?: boolean }) {
  const { t } = useTranslation('tasks');
  const [full, setFull] = useState(false);
  const { preview, truncated } = truncateLines(text);
  const body = full ? text : preview;
  return (
    <div className="tool-output-block">
      <ScrollArea className="max-h-60" viewportClassName="max-h-[inherit]" gutter>
        <pre className="m-0 text-xs leading-4.5 whitespace-pre-wrap wrap-anywhere">{body}</pre>
      </ScrollArea>
      {truncated && !live && (
        <Button variant="ghost" size="sm" onClick={() => setFull(!full)}>
          {full ? t('activity.hideOutput') : t('activity.showOutput')}
        </Button>
      )}
    </div>
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
          {text && <ToolOutput text={text} live={running} />}
        </div>
      );
    default:
      return (
        <>
          {text && <ToolOutput text={text} live={running} />}
          {block.status === 'interrupted' && (
            <p className="text-xs text-muted-foreground">{t('activity.interruptedNote')}</p>
          )}
        </>
      );
  }
}
