import { SHOW_UI_TOOL } from '@atd/agent-contracts';
import type { Block } from '../../../client/agent/transcript-schema';
import { ViewCard } from '../generative-views/view-card';
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
      // A view stands alone in its turn (`foldTurn`); a waiting one carries its input request.
      if (block.name === SHOW_UI_TOOL)
        return <ViewCard block={block} request={request?.kind === 'input' ? request : undefined} />;
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
