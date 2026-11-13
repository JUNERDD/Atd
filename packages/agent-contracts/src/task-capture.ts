import type { CaptureAnswerAction } from './capture-answer.js';
import type { TaskInput } from './task.js';

/** Context filenames produced by the native Screenshot, Long Screenshot, and Screen Recording contracts. */
const CAPTURE_CONTEXT =
  /^(?:Screenshot|Screen Recording)(?: \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}(?: long)?)? context\.md$/;

/**
 * Whether the input came from a screenshot or screen recording. Capture questions and saved
 * commands can also carry the shell's Markdown context file under other `input.source` values.
 */
export function isCaptureInput(input: Pick<TaskInput, 'source' | 'files'>): boolean {
  return (
    input.source === 'screenshot' ||
    input.source === 'recording' ||
    input.files.some((file) => file.type === 'text/markdown' && CAPTURE_CONTEXT.test(file.name))
  );
}

/** Whether a run snapshot originated from a screenshot or screen recording. */
export function isCaptureSnapshot(snapshot: {
  input: Pick<TaskInput, 'source' | 'files'>;
  fromCapture?: boolean | undefined;
  captureOutput?: CaptureAnswerAction | undefined;
}): boolean {
  return (
    snapshot.fromCapture === true ||
    snapshot.captureOutput !== undefined ||
    isCaptureInput(snapshot.input)
  );
}
