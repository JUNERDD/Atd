import { Suspense, use } from 'react';
import { loadMarkdown, loadedMarkdown } from './markdown-loader';

type MarkdownProps = { text: string; streaming: boolean };

/** The text as written, in the rendered markdown's container, until the renderer can take over. */
function PlainMarkdown({ text }: { text: string }) {
  return <div className="markdown whitespace-pre-wrap">{text}</div>;
}

/** Suspends only until the renderer chunk first loads; later instances render synchronously. */
function RichMarkdown({ text, streaming }: MarkdownProps) {
  const renderer = loadedMarkdown() ?? use(loadMarkdown());
  if (!renderer) return <PlainMarkdown text={text} />;
  return <renderer.StreamdownMarkdown text={text} streaming={streaming} />;
}

/** Markdown for messages, thinking, summaries and detail text, loading the renderer on demand. */
export function LazyMarkdown({ text, streaming }: MarkdownProps) {
  return (
    <Suspense fallback={<PlainMarkdown text={text} />}>
      <RichMarkdown text={text} streaming={streaming} />
    </Suspense>
  );
}
