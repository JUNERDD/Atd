import { createUnsafeCSSStyleNode, FileStream, wrapUnsafeCSS } from '@pierre/diffs';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type UIEvent,
} from 'react';
import { cn } from '@atd/ui/lib/utils';
import { CODE_CSS, CodeFile } from './code-block';
import { CopyButton } from './copy-button';
import { CodeDownloadButton } from './download-button';
import { codeSource } from './selection-toolbar/code-sources';

type ThemeType = 'light' | 'dark';

/** Within this many pixels of the bottom the reader still counts as following the stream. */
const FOLLOW_SLACK = 8;

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** The app's theme, as `CodeFile` reads it: `class="dark"` on the root element. */
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
  // `FileStream` ignores `unsafeCSS`, so `CODE_CSS` joins the shadow root that `setup` builds in
  // `mount` the way `File` adds it; `setup` settles before the first frame draws a line.
  void renderer.setup(source, mount).then(() => {
    const style = createUnsafeCSSStyleNode();
    style.textContent = wrapUnsafeCSS(CODE_CSS);
    mount.firstElementChild?.shadowRoot?.append(style);
  });
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

/** Where a box is scrolled; `atBottom` while its last line is in view (within `FOLLOW_SLACK`). */
type ScrollSnapshot = { top: number; left: number; atBottom: boolean };

function scrollSnapshot(box: HTMLElement): ScrollSnapshot {
  const { scrollTop, scrollLeft, scrollHeight, clientHeight } = box;
  return {
    top: scrollTop,
    left: scrollLeft,
    atBottom: scrollHeight - scrollTop - clientHeight <= FOLLOW_SLACK,
  };
}

/**
 * A message's fenced block from its first line on. While the fence is open, `@pierre/diffs`
 * tokenizes the text line by line as it arrives and appends each line's DOM once per frame, in the
 * same highlighter, shadow root, theme and `CODE_CSS` as `CodeFile`, which draws the block once the
 * fence closes (on the main thread, so a closing fence never flashes plain text while a worker
 * highlights it) as the download action joins copy. The frame and the box that scrolls it stay the
 * same elements throughout, so the close changes neither the block's height nor where the reader
 * has scrolled it. Growth that is not a pure append (a resend, an edit, a recalled line) starts
 * the stream over. The box scrolls the block both ways; past its height an open block keeps its
 * last line in view until the reader scrolls up, and follows again once they scroll back down.
 */
export function StreamingCodeBlock({
  contents,
  language,
  open,
  className,
}: {
  contents: string;
  /** A language from `codeLanguage`. */
  language: string;
  /** The fence is still open: its lines stream in, and there is nothing to download yet. */
  open: boolean;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const stream = useRef<HTMLDivElement | null>(null);
  const feed = useRef<Feed | null>(null);
  const following = useRef(true);
  // Where the box was scrolled as the stream's mount left it, until the closed fence takes over.
  const closing = useRef<ScrollSnapshot | null>(null);
  const themeType = useSyncExternalStore(subscribeTheme, themeSnapshot);
  // A fence's final newline ends its last line, as in `CodeFile`; dropping it keeps each patch a
  // pure append of the text before it.
  const text = contents.replace(/\r?\n$/, '');

  // React cleans up a removed element's ref before it takes the element out and puts the
  // replacement in, so the stream's mount reads where the box is scrolled while the box still
  // holds the streamed lines. Its `scroll` events come a frame late and may not have caught up.
  const mountStream = useCallback((node: HTMLDivElement | null) => {
    stream.current = node;
    if (!node) return;
    return () => {
      stream.current = null;
      const box = viewport.current;
      if (box) closing.current = scrollSnapshot(box);
    };
  }, []);

  useEffect(() => {
    const box = viewport.current;
    const host = stream.current;
    if (!open || !box || !host) return;
    let current = feed.current;
    if (!current || current.language !== language || !text.startsWith(current.sent)) {
      current?.dispose();
      following.current = true;
      current = openFeed(host, language, themeType, () => {
        if (following.current) box.scrollTop = box.scrollHeight;
      });
      feed.current = current;
    }
    current.renderer.setThemeType(themeType);
    current.append(text);
  }, [open, text, language, themeType]);

  // The closed fence's code replaces the stream's mount; the stream ends with it.
  useEffect(() => {
    if (open) return;
    feed.current?.dispose();
    feed.current = null;
  }, [open]);

  useEffect(
    () => () => {
      feed.current?.dispose();
      feed.current = null;
    },
    [],
  );

  // `CodeFile` has drawn the closed fence by now: a child's layout effect runs first, and pierre
  // draws at once with the highlighter the stream loaded. The reader stays where the snapshot has
  // them, on the last line if it was in view; a layout read while the box briefly held neither
  // renderer would otherwise have pulled its scroll in.
  useLayoutEffect(() => {
    const box = viewport.current;
    const last = closing.current;
    if (open || !box || !last) return;
    closing.current = null;
    box.scrollLeft = last.left;
    box.scrollTop = last.atBottom ? box.scrollHeight : last.top;
  }, [open]);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    following.current = scrollSnapshot(event.currentTarget).atBottom;
  }

  return (
    <div {...codeSource({ contents, language })} className={cn('code-block group', className)}>
      <div ref={viewport} className="code-block-file" onScroll={onScroll}>
        {open ? (
          <div ref={mountStream} />
        ) : (
          <CodeFile contents={contents} language={language} disableWorkerPool />
        )}
      </div>
      <div className="code-block-actions">
        {!open && <CodeDownloadButton contents={contents} language={language} />}
        <CopyButton text={contents} className="static" />
      </div>
    </div>
  );
}
