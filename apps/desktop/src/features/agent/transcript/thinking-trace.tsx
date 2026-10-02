import { useMemo } from 'react';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { DetailBox } from './detail-box';
import { useFollowStream } from './thinking-follow';

/**
 * The opened reasoning trace, as the plain text the model wrote: reasoning is read as detail, and
 * parsing a long trace as markdown stalled the expand. Each paragraph is its own block, so a
 * streamed delta re-renders and re-lays out only the last one, and a settled trace lays out only
 * the paragraphs near the capped box's view (`.thinking-text` in `agent.css`).
 */
export function ThinkingTrace({ block }: { block: BlockOf<'thinking'> }) {
  const followRef = useFollowStream(block.streaming);
  const paragraphs = useMemo(() => block.text.split(/\n{2,}/), [block.text]);
  return (
    <DetailBox variant="plain" copyText={block.text}>
      <div
        ref={followRef}
        className="thinking-text whitespace-pre-wrap"
        data-streaming={block.streaming || undefined}
      >
        {/* A trace only grows at its end, so a paragraph keeps its index as its identity. */}
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </DetailBox>
  );
}
