import type { ViewBlock } from './adapter';
import { QuestionBlock } from './question-block';
import { SystemBlock, ThinkingBlock } from './thinking-block';
import { ToolBlock } from './tool-block';
import { isPendingWrite, requestFor, type RequestIndex } from './turns';

/**
 * One step inside an activity phase. Every kind keeps its existing block renderer against the
 * same `source` block.
 */
export function PhaseStep({ view, requests }: { view: ViewBlock; requests: RequestIndex }) {
  const block = view.source;
  const request = requestFor(block, requests);
  switch (block.kind) {
    case 'user':
      return null;
    case 'assistant':
      // Unreachable: `foldTurn` keeps prose standalone, rendered by `AssistantBlock`.
      return null;
    case 'thinking':
      return <ThinkingBlock block={block} />;
    case 'tool': {
      const confirmation = request?.kind === 'confirmation' ? request : undefined;
      return (
        <ToolBlock
          block={block}
          confirmation={confirmation}
          forceOpen={isPendingWrite(block, request)}
        />
      );
    }
    case 'question':
      return (
        <QuestionBlock block={block} request={request?.kind === 'input' ? request : undefined} />
      );
    case 'system':
      return <SystemBlock block={block} />;
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return null;
    }
  }
}
