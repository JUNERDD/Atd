import { FileStream } from '@pierre/diffs';
import { useEffect, useRef, useSyncExternalStore, type UIEvent } from 'react';
import { cn } from '@ai/ui/lib/utils';
import { CopyButton } from './copy-button';
import { codeSource } from './selection-toolbar/code-sources';

type ThemeType = 'light' | 'dark';

/** Within this many pixels of the bottom the reader still counts as following the stream. */
const FOLLOW_SLACK = 8;

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** The app's theme, as `CodeBlock` reads it: `class="dark"` on the root element. */
function themeSnapshot(): ThemeType {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** One `FileStream` and the stream feeding it; `sent` is the text it has been given so far. */
type Feed = {
  renderer: FileStream;
  language: string;
  sent: string;
  append: (text: string) => void;
  dispose: () => void;
};

/**
 * Starts a renderer in its own mount under `host`. A renderer that is replaced before its
 * highlighter loads still finishes its setup later; it then lands in a detached mount, and the
 * closed input lets its pipe end, so it never paints over its successor.
 */
function openFeed(
  host: HTMLElement,
  language: string,
  themeType: ThemeType,
  onRender: () => void,
): Feed {
  // Live from the stream's start until the renderer cancels it (`cleanUp`, or a failed pipe).
  let input: ReadableStreamDefaultController<string> | null = null;
  const source = new ReadableStream<string>({
    start(controller) {
      input = controller;
    },
    cancel() {
      input = null;
    },
  });
  const renderer = new FileStream({
    lang: language,
    themeType,
    overflow: 'scroll',
    onPostRender: onRender,
  });
  const mount = document.createElement('div');
  host.replaceChildren(mount);
  void renderer.setup(source, mount);
  const feed: Feed = {
    renderer,
    language,
    sent: '',
    append(text) {
      const chunk = text.slice(feed.sent.length);
      if (!chunk) return;
      input?.enqueue(chunk);
      feed.sent = text;
    },
    dispose() {
      input?.close();
      input = null;
      renderer.cleanUp();
    },
  };
  return feed;
}

/**
 * A fenced block while its fence is still open: `@pierre/diffs` tokenizes the text line by line
 * as it arrives and appends each line's DOM once per frame, in the same highlighter, shadow root,
 * theme and frame as `CodeBlock`, which takes over once the fence closes. Growth that is not a
 * pure append (a resend, an edit, a recalled line) starts the stream over. Past the owner's height
 * the block keeps its last line in view until the reader scrolls up, and follows again once they
 * scroll back to the bottom.
 */
export function StreamingCodeBlock({
  contents,
  language,
  className,
}: {
  contents: string;
  /** A language from `codeLanguage`. */
  language: string;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const feed = useRef<Feed | null>(null);
  const following = useRef(true);
  const themeType = useSyncExternalStore(subscribeTheme, themeSnapshot);
  // A fence's final newline ends its last line, as in `CodeBlock`; dropping it keeps each patch a
  // pure append of the text before it.
  const text = contents.replace(/\r?\n$/, '');

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    let current = feed.current;
    if (!current || current.language !== language || !text.startsWith(current.sent)) {
      current?.dispose();
      following.current = true;
      current = openFeed(host, language, themeType, () => {
        if (following.current) host.scrollTop = host.scrollHeight;
      });
      feed.current = current;
    }
    current.renderer.setThemeType(themeType);
    current.append(text);
  }, [text, language, themeType]);

  useEffect(
    () => () => {
      feed.current?.dispose();
      feed.current = null;
    },
    [],
  );

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
    following.current = scrollHeight - scrollTop - clientHeight <= FOLLOW_SLACK;
  }

  return (
    <div {...codeSource({ contents, language })} className={cn('code-block group', className)}>
      <div ref={viewport} className="code-block-file" onScroll={onScroll} />
      <CopyButton text={contents} />
    </div>
  );
}
