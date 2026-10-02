import { Suspense, use } from 'react';
import { loadMarkdown, loadedMarkdown } from './markdown-loader';

type MarkdownProps = {
  text: string;
  streaming: boolean;
  /** Per-character reveal while streaming; see `StreamdownMarkdown`. Defaults to on. */
  animated?: boolean | undefined;
};

/** The text as written, in the rendered markdown's container, until the renderer can take over. */
function PlainMarkdown({ text }: { text: string }) {
  return <div className="markdown whitespace-pre-wrap">{text}</div>;
}

/** Suspends only until the renderer chunk first loads; later instances render synchronously. */
function RichMarkdown({ text, streaming, animated }: MarkdownProps) {
  const renderer = loadedMarkdown() ?? use(loadMarkdown());
  if (!renderer) return <PlainMarkdown text={text} />;
  return <renderer.StreamdownMarkdown text={text} streaming={streaming} animated={animated} />;
}

/** Markdown for messages, thinking, summaries and detail text, loading the renderer on demand. */
export function LazyMarkdown({ text, streaming, animated }: MarkdownProps) {
  return (
    <Suspense fallback={<PlainMarkdown text={text} />}>
      <RichMarkdown text={text} streaming={streaming} animated={animated} />
    </Suspense>
  );
}
