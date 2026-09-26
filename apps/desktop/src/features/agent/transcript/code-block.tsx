import { File } from '@pierre/diffs/react';
import { cn } from '@ai/ui/lib/utils';
import { CopyButton } from './copy-button';

/**
 * The project's one code block: `@pierre/diffs` renders the text with Shiki highlighting and line
 * numbers in its own shadow root, in the app's theme (`class="dark"` on the root element), and
 * the transcript's copy button appears on hover. A file's final newline ends its last line rather
 * than opening an empty one; copy keeps the text as given. The block scrolls sideways; its owner
 * decides the height.
 */
export function CodeBlock({
  contents,
  language,
  className,
}: {
  contents: string;
  /** A language from `codeLanguage` or `getFiletypeFromFileName`. */
  language: string;
  className?: string;
}) {
  const themeType = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return (
    <div className={cn('code-block group', className)}>
      <File
        className="code-block-file"
        file={{ name: '', contents: contents.replace(/\r?\n$/, ''), lang: language }}
        options={{ themeType, disableFileHeader: true, overflow: 'scroll' }}
      />
      <CopyButton text={contents} />
    </div>
  );
}
