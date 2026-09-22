import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { ServiceBlock } from '@ai/agent-contracts';
import {
  diffServiceBlocks,
  firstInvocationRunId,
  fromServiceBranch,
  projectServiceBlocks,
  toolPartialText,
} from './transcript.js';

export interface TranscriptPatchData {
  revision: number;
  snapshot: boolean;
  blocks: ServiceBlock[];
  removed: string[];
}

export interface LiveTranscriptSink {
  publish: (runId: string, patch: TranscriptPatchData) => void;
  sessionFile: (file: string) => void;
}

/**
 * Live transcript of one Pi session. Subscribes to session events, reprojects
 * the 0.86 branch on every change, and publishes patches; the cold path in
 * the runner reuses the same projection so the two cannot diverge.
 */
export class LiveTranscript {
  private blocks: ServiceBlock[] = [];
  private revision = 0;
  private readonly partials = new Map<string, string>();
  private partial: AssistantMessage | undefined;
  private queue: { steering: string[]; followUp: string[] } = { steering: [], followUp: [] };

  constructor(
    private readonly session: AgentSession,
    private readonly manager: SessionManager,
    private readonly sink: LiveTranscriptSink,
    private readonly runId: () => string,
  ) {}

  attach(): void {
    this.session.subscribe((event) => {
      if (event.type === 'queue_update') {
        this.queue = { steering: [...event.steering], followUp: [...event.followUp] };
        return;
      }
      if (event.type === 'message_update' && event.message.role === 'assistant')
        this.partial = event.message;
      if (event.type === 'message_end') {
        if (event.message.role === 'assistant') this.partial = undefined;
        const file = this.session.sessionFile;
        if (file) this.sink.sessionFile(file);
      }
      if (event.type === 'tool_execution_update')
        this.partials.set(event.toolCallId, toolPartialText(event.partialResult));
      if (event.type === 'tool_execution_end') this.partials.delete(event.toolCallId);
      this.reproject(false);
    });
  }

  snapshot(): { revision: number; blocks: ServiceBlock[] } {
    return { revision: this.revision, blocks: [...this.blocks] };
  }

  queueState(): { steering: string[]; followUp: string[] } {
    return { steering: [...this.queue.steering], followUp: [...this.queue.followUp] };
  }

  reproject(snapshot: boolean): void {
    const branch = fromServiceBranch(this.manager.getBranch());
    const runId = this.runId();
    const next = projectServiceBlocks({
      branch,
      partial: this.partial,
      partials: this.partials,
      defaultRunId: firstInvocationRunId(branch) ?? runId,
      live: true,
    });
    const patch = diffServiceBlocks(this.blocks, next);
    this.blocks = next;
    this.revision += 1;
    if (patch.blocks.length || patch.removed.length || snapshot)
      this.sink.publish(runId, {
        revision: this.revision,
        snapshot,
        blocks: snapshot ? next : patch.blocks,
        removed: snapshot ? [] : patch.removed,
      });
  }
}
