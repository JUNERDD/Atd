import { getFiletypeFromFileName, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useMemo, type ReactNode } from 'react';
import { cn } from '@atd/ui/lib/utils';
import { CodeBlock, FLUSH_CODE_CLASS, FLUSH_CODE_CSS } from './code-block';
import { codeCacheKey } from './code-cache-key';
import { excerptPatch, parsePatch } from './pi-diff';
import { ToolCard } from './tool-card';
import './tool-code.css';

/** The app's theme as `CodeBlock` reads it: `class="dark"` on the root element. */
function themeType(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** The last segment of a tool's `path` argument, which names the file in the card header. */
function fileName(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * A file's text with Shiki highlighting in `@pierre/diffs`, in the same theme and type as
 * `CodeBlock`. `startLine` numbers the first line: text from line 1 is a `CodeBlock`; an excerpt
 * from further down renders as one unchanged hunk so its numbers match the file, since the plain
 * file renderer always counts from 1. Text that does not form a patch shows unnumbered.
 */
export function SourceView({
  path,
  text,
  startLine = 1,
  cacheable = false,
}: {
  path: string;
  text: string;
  startLine?: number;
  /**
   * The text is final (its call has settled), so the highlight pool caches its highlighting under
   * a key derived from the content (`codeCacheKey`).
   */
  cacheable?: boolean;
}) {
  const cacheKey = useMemo(
    () =>
      cacheable
        ? codeCacheKey(startLine <= 1 ? 'file' : 'excerpt', path, text, startLine)
        : undefined,
    [cacheable, path, text, startLine],
  );
  const excerpt = useMemo(() => {
    if (startLine <= 1) return null;
    const patch = excerptPatch(path, text, startLine);
    return patch ? parsePatch(patch, cacheKey) : null;
  }, [path, text, startLine, cacheKey]);
  if (startLine <= 1) {
    return (
      <CodeBlock
        contents={text}
        language={getFiletypeFromFileName(path)}
        flush
        cacheKey={cacheKey}
      />
    );
  }
  if (excerpt) return <DiffView fileDiff={excerpt} indicators={false} />;
  return <PlainText text={text} />;
}

/**
 * A parsed patch in the unified style, highlighted by its file name and drawn flush on the card
 * like a flush `CodeBlock`. `indicators` shows the `+`/`−` column, so added and removed lines
 * never rely on their tint alone; an excerpt, which has only unchanged lines, leaves it out.
 * Hunks are divided by a plain separator, without the renderer's untranslated "unmodified lines"
 * caption.
 */
export function DiffView({
  fileDiff,
  indicators = true,
}: {
  fileDiff: FileDiffMetadata;
  indicators?: boolean;
}) {
  return (
    <FileDiff
      className={cn('code-block-file', FLUSH_CODE_CLASS)}
      fileDiff={fileDiff}
      options={{
        themeType: themeType(),
        diffStyle: 'unified',
        diffIndicators: indicators ? 'classic' : 'none',
        hunkSeparators: 'simple',
        disableFileHeader: true,
        overflow: 'scroll',
        unsafeCSS: FLUSH_CODE_CSS,
      }}
    />
  );
}

/** Tool text shown as is: monospace, wrapping inside the card. */
export function PlainText({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <pre className={muted ? 'tool-code-plain text-muted-foreground' : 'tool-code-plain'}>
      {text}
    </pre>
  );
}

/**
 * The card every file tool reads in: a type glyph and the file's name (full path on hover) with
 * trailing facts and the copy action, the content, and an optional closing note. `code` content
 * fills the body edge to edge; plain text keeps the card's inset. A tall body scrolls inside the
 * card. Code keeps its line widths and the body scrolls it both ways, so the sideways bar sits at
 * the bottom of the visible box rather than under the file's last line.
 */
export function FileCard({
  icon,
  path,
  meta,
  copyText,
  code,
  footer,
  children,
}: {
  icon: ReactNode;
  path: string;
  meta?: ReactNode;
  copyText?: string | undefined;
  /** The body is rendered code (`SourceView`, `DiffView`) rather than plain text. */
  code: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ToolCard.Root className="tool-code">
      <ToolCard.Header
        icon={icon}
        label={<span title={path}>{fileName(path)}</span>}
        meta={meta}
        copyText={copyText}
      />
      <ToolCard.Body
        size="lg"
        scroll={code ? 'both' : 'y'}
        flush={code}
        className={code ? undefined : 'font-mono'}
      >
        {children}
      </ToolCard.Body>
      {footer}
    </ToolCard.Root>
  );
}
