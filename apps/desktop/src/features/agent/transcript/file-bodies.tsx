import { FilePlus, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { FileCard, PlainText, SourceView } from './file-card';
import { ToolCard } from './tool-card';
import { parseReadNotice, splitNotice } from './tool-output';

/** A result that is one bracketed sentence, such as Pi's over-long first line notice. */
const NOTICE_ONLY = /^\[[^\n]*\]$/;
/** Pi's text for a read image (`Read image file [image/png]`): the image is not text to show. */
const IMAGE_RESULT = /^Read image file \[/;

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Lines in a file text; a final newline ends the last line instead of opening another. */
function lineCount(text: string): number {
  return text.replace(/\r?\n$/, '').split('\n').length;
}

/** Pi's `read` notice in the reader's language when its shape is known, else verbatim. */
function useReadNotice(notice: string | null): string | null {
  const { t } = useTranslation('tasks');
  if (!notice) return null;
  const parsed = parseReadNotice(notice);
  if (parsed?.kind === 'showing') {
    const { start, end, total } = parsed;
    return t('toolCode.showingLines', { start, end, total });
  }
  if (parsed?.kind === 'more') return t('toolCode.moreLines', { count: parsed.count });
  return notice;
}

/**
 * The closing note of a file call that did not succeed: the tool's error or the decline in the
 * destructive tone, or the interruption note. A success says nothing here, since the header
 * already names the file and its size and Pi's confirmation would only repeat them.
 */
function StatusFooter({ block, text }: { block: BlockOf<'tool'>; text: string }) {
  const { t } = useTranslation('tasks');
  if (block.status === 'interrupted') {
    return <ToolCard.Footer>{t('activity.interruptedNote')}</ToolCard.Footer>;
  }
  if ((block.status !== 'failed' && block.status !== 'declined') || !text) return null;
  return (
    <ToolCard.Footer tone="destructive">
      <span className="tool-code-note">{text}</span>
    </ToolCard.Footer>
  );
}

/**
 * A file call whose result is not file text (an error, a decline, an image, a bare notice): the
 * tool's words as plain text, the error in the primary color and anything else muted. An
 * interrupted call says so in place of a result it never got.
 */
function PlainFileCard({
  block,
  icon,
  path,
  text,
}: {
  block: BlockOf<'tool'>;
  icon: ReactNode;
  path: string;
  text: string;
}) {
  const { t } = useTranslation('tasks');
  const interrupted = block.status === 'interrupted' && (
    <ToolCard.Footer>{t('activity.interruptedNote')}</ToolCard.Footer>
  );
  if (!text) {
    // A call reaches its body with no text only when it was interrupted (`hasToolDetail`).
    return interrupted ? (
      <FileCard icon={icon} path={path} code={false}>
        <p className="m-0 font-sans text-muted-foreground">{t('activity.interruptedNote')}</p>
      </FileCard>
    ) : null;
  }
  return (
    <FileCard icon={icon} path={path} copyText={text} code={false} footer={interrupted}>
      <PlainText text={text} muted={block.status !== 'failed'} />
    </FileCard>
  );
}

/**
 * A `read` call: the file text highlighted by the path's language and numbered from the line the
 * read started at, with the range in the header and Pi's continuation notice as the closing note.
 * Failures, declines, images, and notice-only results read as plain text.
 */
export function ReadBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const path = stringArg(block.args.path);
  const text = block.status === 'running' ? block.partial : block.output;
  const { body, notice } = splitNotice(text);
  const noticeText = useReadNotice(notice);
  const isCode =
    (block.status === 'completed' || block.status === 'running') &&
    body.trim() !== '' &&
    !IMAGE_RESULT.test(body) &&
    !NOTICE_ONLY.test(body.trim());
  if (!isCode) {
    return <PlainFileCard block={block} icon={<FileText />} path={path} text={text} />;
  }
  const offset = block.args.offset;
  const startLine =
    typeof offset === 'number' && Number.isInteger(offset) && offset > 1 ? offset : 1;
  const count = lineCount(body);
  const meta: ReactNode =
    startLine > 1 || notice
      ? t('toolCode.lineRange', { start: startLine, end: startLine + count - 1 })
      : t('toolCode.lineCount', { count });
  return (
    <FileCard
      icon={<FileText />}
      path={path}
      meta={meta}
      copyText={body}
      code
      footer={
        noticeText && (
          <ToolCard.Footer>
            <span className="tool-code-note">{noticeText}</span>
          </ToolCard.Footer>
        )
      }
    >
      <SourceView
        path={path}
        text={body}
        startLine={startLine}
        cacheable={block.status !== 'running'}
      />
    </FileCard>
  );
}

/**
 * A `write` call: the content it wrote, highlighted by the path's language with its line count,
 * and the tool's error or decline as the closing note. Without `content` in the arguments the
 * card shows the tool's text instead.
 */
export function WriteBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const path = stringArg(block.args.path);
  const content = stringArg(block.args.content);
  const text = block.status === 'running' ? block.partial : block.output;
  if (!content) {
    return <PlainFileCard block={block} icon={<FilePlus />} path={path} text={text} />;
  }
  return (
    <FileCard
      icon={<FilePlus />}
      path={path}
      meta={t('toolCode.lineCount', { count: lineCount(content) })}
      copyText={content}
      code
      footer={<StatusFooter block={block} text={text} />}
    >
      <SourceView path={path} text={content} cacheable={block.status !== 'running'} />
    </FileCard>
  );
}
