import { File } from '@pierre/diffs/react';
import { cn } from '@atd/ui/lib/utils';
import { CopyButton } from './copy-button';
import { CodeDownloadButton } from './download-button';
import { codeSource } from './selection-toolbar/code-sources';
import './tool-code.css';

/**
 * Shadow-root rules (`@pierre/diffs`' `unsafeCSS`) every settled block takes: the code element is
 * as wide as its longest line and never scrolls sideways itself, so the block's owner scrolls it
 * both ways and keeps the bar at the bottom of the visible box. Pierre would scroll long lines
 * inside that element, under a bar sized from a scrollbar it measured while the block was still
 * hidden (often to nothing) and placed below the last line. The element's paint containment would
 * clip lines that spilled past it, so it holds them at full width instead. `StreamingCodeBlock`'s
 * renderer takes no `unsafeCSS` and keeps pierre's own scrolling until its fence closes.
 */
const CODE_CSS = '[data-code] { overflow-x: visible; min-width: max-content; }';

/**
 * `CODE_CSS` for code drawn flush on its owner's surface. The renderer pins the line-number gutter
 * over code that scrolls sideways and relies on the theme's opaque background to cover it; on a
 * see-through surface the code would show through the numbers, so the gutter scrolls with the code
 * instead.
 */
export const FLUSH_CODE_CSS = `${CODE_CSS} [data-overflow=scroll] [data-gutter] { position: static; }`;

/**
 * The class that, with `FLUSH_CODE_CSS`, draws a `@pierre/diffs` host on its owner's surface
 * (`tool-code.css` clears the theme's background and sets the line-number and diff colors).
 */
export const FLUSH_CODE_CLASS = 'code-block-flush';

/**
 * The project's one code block: `@pierre/diffs` renders the text with Shiki highlighting and line
 * numbers in its own shadow root, in the app's theme (`class="dark"` on the root element), and
 * the transcript's copy button (with a download button when `downloadable`) appears on hover. A
 * file's final newline ends its last line rather than opening an empty one; copy and download
 * keep the text as given. The block never scrolls itself (`CODE_CSS`): its owner scrolls it both
 * ways and decides the height. The root records its source so a selection copies the block whole.
 */
export function CodeBlock({
  contents,
  language,
  className,
  downloadable = false,
  flush = false,
  disableWorkerPool = false,
  cacheKey,
}: {
  contents: string;
  /** A language from `codeLanguage` or `getFiletypeFromFileName`. */
  language: string;
  className?: string;
  /** Offers the block as a file named after its language, through the native save panel. */
  downloadable?: boolean;
  /**
   * Draws the code on its owner's surface (a tool card) instead of the highlighting theme's own
   * background, with muted line numbers that scroll with the code.
   */
  flush?: boolean;
  /**
   * Highlights on the main thread even inside `CodeHighlightPool`, so the block's first paint is
   * already highlighted instead of plain until a worker answers.
   */
  disableWorkerPool?: boolean;
  /**
   * Names the highlighted `contents` in `CodeHighlightPool`'s cache (`codeCacheKey`), so the block
   * paints highlighted from it when it mounts again; leave it out while the text still changes.
   */
  cacheKey?: string | undefined;
}) {
  const themeType = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return (
    <div {...codeSource({ contents, language })} className={cn('code-block group', className)}>
      <File
        className={cn('code-block-file', flush && FLUSH_CODE_CLASS)}
        file={{
          name: '',
          contents: contents.replace(/\r?\n$/, ''),
          lang: language,
          ...(cacheKey ? { cacheKey } : {}),
        }}
        options={{
          themeType,
          disableFileHeader: true,
          overflow: 'scroll',
          unsafeCSS: flush ? FLUSH_CODE_CSS : CODE_CSS,
        }}
        disableWorkerPool={disableWorkerPool}
      />
      {downloadable && <CodeDownloadButton contents={contents} language={language} />}
      <CopyButton text={contents} />
    </div>
  );
}
