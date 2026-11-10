import type { TaskInput } from './task.js';

/** The context filename produced by the native RecordingFileNames.context contract. */
const RECORDING_CONTEXT = /^Screen Recording \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2} context\.md$/;

/**
 * Whether the input came from a screenshot or screen recording. Recording questions saved before
 * the recording source existed kept the shell's Markdown context file with a manual source.
 */
export function isCaptureInput(input: Pick<TaskInput, 'source' | 'files'>): boolean {
  return (
    input.source === 'screenshot' ||
    input.source === 'recording' ||
    (input.source === 'manual' &&
      input.files.some(
        (file) => file.type === 'text/markdown' && RECORDING_CONTEXT.test(file.name),
      ))
  );
}
