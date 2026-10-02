import { File } from '@pierre/diffs/react';
import { cn } from '@ai/ui/lib/utils';
import { CopyButton } from './copy-button';
import { CodeDownloadButton } from './download-button';
import { codeSource } from './selection-toolbar/code-sources';

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
}: {
  contents: string;
  /** A language from `codeLanguage` or `getFiletypeFromFileName`. */
  language: string;
  className?: string;
  /** Offers the block as a file named after its language, through the native save panel. */
  downloadable?: boolean;
}) {
  const themeType = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return (
    <div {...codeSource({ contents, language })} className={cn('code-block group', className)}>
      <File
        className="code-block-file"
        file={{ name: '', contents: contents.replace(/\r?\n$/, ''), lang: language }}
        options={{ themeType, disableFileHeader: true, overflow: 'scroll' }}
      />
      {downloadable && <CodeDownloadButton contents={contents} language={language} />}
      <CopyButton text={contents} />
    </div>
  );
}
