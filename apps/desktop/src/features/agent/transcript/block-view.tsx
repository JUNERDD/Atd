import type { Block } from '../../../client/agent/transcript-schema';
import { AssistantBlock } from './assistant-block';
import { CompactionBlock } from './compaction-block';
import { QuestionBlock } from './question-block';
import { RetryBlock } from './retry-block';
import { SystemBlock, ThinkingBlock } from './thinking-block';
import { ToolBlock } from './tool-block';
import { requestFor, type RequestIndex } from './turns';

export function BlockView({ block, requests }: { block: Block; requests: RequestIndex }) {
  const request = requestFor(block, requests);
  switch (block.kind) {
    case 'user':
      return null;
    case 'assistant':
      return <AssistantBlock block={block} />;
    case 'thinking':
      return <ThinkingBlock block={block} />;
    case 'tool': {
      const confirmation = request?.kind === 'confirmation' ? request : undefined;
      return <ToolBlock block={block} confirmation={confirmation} />;
    }
    case 'question':
      return (
        <QuestionBlock block={block} request={request?.kind === 'input' ? request : undefined} />
      );
    case 'system':
      return <SystemBlock block={block} />;
    case 'compaction':
      return <CompactionBlock block={block} />;
    case 'retry':
      return <RetryBlock block={block} />;
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return null;
    }
  }
}
