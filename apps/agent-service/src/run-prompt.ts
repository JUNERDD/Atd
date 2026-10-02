import type { ImageContent } from '@earendil-works/pi-ai';
import type { TaskRun } from '@atd/agent-contracts';
import type { RunAttachment } from './pi-session.js';

/** The user message a run prompts with: its text, else the command's instructions. */
export function runPromptText(run: TaskRun): string {
  return run.snapshot.input.text.trim() || run.snapshot.instructions || 'Use the attached context.';
}

/**
 * How a run's prompt is sent. Nothing in the text expands, and the run's image files go with it
 * as image input: Pi scales them to the model's limits, and for a model without image input it
 * sends a text placeholder in their place. Queued follow-ups and steers (`TaskRunner.queue`) carry
 * text only; the images stay in the session history the prompt created.
 */
export function runPromptOptions(attachments: readonly RunAttachment[]): {
  expandPromptTemplates: false;
  images: ImageContent[];
} {
  return {
    expandPromptTemplates: false,
    images: attachments.flatMap((file) => (file.kind === 'image' ? [file.image] : [])),
  };
}
