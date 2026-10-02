import { File } from '@pierre/diffs/react';
import { cn } from '@atd/ui/lib/utils';
import { CopyButton } from './copy-button';
import { CodeDownloadButton } from './download-button';
import { codeSource } from './selection-toolbar/code-sources';
import './tool-code.css';

/**
 * Shadow-root rules (`@pierre/diffs`' `unsafeCSS`) for code drawn flush on its owner's surface.
 * The renderer pins the line-number gutter over code that scrolls sideways and relies on the
 * theme's opaque background to cover it; on a see-through surface the code would show through
 * the numbers, so the gutter scrolls with the code instead.
 */
export const FLUSH_CODE_CSS = '[data-overflow=scroll] [data-gutter] { position: static; }';

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
 * keep the text as given. The block scrolls sideways; its owner
 * decides the height. The root records its source so a selection copies the block whole.
 */
export function CodeBlock({
  contents,
  language,
  className,
  downloadable = false,
  flush = false,
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
}) {
  const themeType = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return (
    <div {...codeSource({ contents, language })} className={cn('code-block group', className)}>
      <File
        className={cn('code-block-file', flush && FLUSH_CODE_CLASS)}
        file={{ name: '', contents: contents.replace(/\r?\n$/, ''), lang: language }}
        options={{
          themeType,
          disableFileHeader: true,
          overflow: 'scroll',
          ...(flush ? { unsafeCSS: FLUSH_CODE_CSS } : {}),
        }}
      />
      {downloadable && <CodeDownloadButton contents={contents} language={language} />}
      <CopyButton text={contents} />
    </div>
  );
}
