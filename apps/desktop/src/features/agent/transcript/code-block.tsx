import { File } from '@pierre/diffs/react';
import { cn } from '@atd/ui/lib/utils';
import { CopyButton } from './copy-button';
import { CodeDownloadButton } from './download-button';
import { codeSource } from './selection-toolbar/code-sources';
import './tool-code.css';

/**
 * Shadow-root rules (`@pierre/diffs`' `unsafeCSS`) every block takes: the code element is as wide
 * as its longest line and never scrolls sideways itself, so the block's owner scrolls it both ways
 * and keeps the bar at the bottom of the visible box. Pierre would scroll long lines inside that
 * element, under a bar sized from a scrollbar it measured while the block was still hidden (often
 * to nothing) and placed below the last line. The element's paint containment would clip lines
 * that spilled past it, so it holds them at full width instead. Pierre also takes that bar's
 * gutter out of the code's bottom padding; with no bar the gutter is zero, so the code keeps the
 * same gap above and below. `StreamingCodeBlock` adds the same rules to its stream, so a fence
 * keeps its height and scrolling when it closes and `CodeFile` takes over.
 */
export const CODE_CSS =
  ':host { --diffs-scrollbar-gutter-override: 0px; } ' +
  '[data-code] { overflow-x: visible; min-width: max-content; }';

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

/** The code `CodeFile` draws, and how. */
type CodeFileProps = {
  contents: string;
  /** A language from `codeLanguage` or `getFiletypeFromFileName`. */
  language: string;
  /**
   * Draws the code on its owner's surface (a tool card) instead of the highlighting theme's own
   * background, with muted line numbers that scroll with the code.
   */
  flush?: boolean;
  /**
   * Highlights on the main thread even inside `CodeHighlightPool`, so the first paint is already
   * highlighted instead of plain until a worker answers.
   */
  disableWorkerPool?: boolean;
  /**
   * Names the highlighted `contents` in `CodeHighlightPool`'s cache (`codeCacheKey`), so the code
   * paints highlighted from it when it mounts again; leave it out while the text still changes.
   */
  cacheKey?: string | undefined;
};

/**
 * The code of every project code block: `@pierre/diffs` renders the text with Shiki highlighting
 * and line numbers in its own shadow root, in the app's theme (`class="dark"` on the root
 * element), under `CODE_CSS` (or `FLUSH_CODE_CSS`). A file's final newline ends its last line
 * rather than opening an empty one. `CodeBlock` frames it; `StreamingCodeBlock` draws a fence
 * with it once the fence closes.
 */
export function CodeFile({
  contents,
  language,
  className,
  flush = false,
  disableWorkerPool = false,
  cacheKey,
}: CodeFileProps & { className?: string }) {
  const themeType = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return (
    <File
      className={cn(flush && FLUSH_CODE_CLASS, className)}
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
  );
}

/**
 * The project's one code block: `CodeFile` in a frame where the transcript's copy button (with a
 * download button when `downloadable`) appears on hover in the block's corner, over a scrim that
 * a long first line fades out under (`.code-block-actions` in `agent.css`). Copy and download
 * keep the text as given. The block never scrolls itself (`CODE_CSS`): its owner scrolls it both
 * ways and decides the height. The root records its source so a selection copies the block whole.
 */
export function CodeBlock({
  className,
  downloadable = false,
  ...code
}: CodeFileProps & {
  className?: string;
  /** Offers the block as a file named after its language, through the native save panel. */
  downloadable?: boolean;
}) {
  const { contents, language } = code;
  return (
    <div {...codeSource({ contents, language })} className={cn('code-block group', className)}>
      <CodeFile {...code} className="code-block-file" />
      <div className="code-block-actions">
        {downloadable && <CodeDownloadButton contents={contents} language={language} />}
        <CopyButton text={contents} className="static" />
      </div>
    </div>
  );
}
