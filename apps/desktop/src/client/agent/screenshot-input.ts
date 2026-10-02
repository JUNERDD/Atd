import { isImageMime, MAX_ATTACHMENTS } from '@atd/agent-contracts';
import type { FileRef, TaskInput } from './task-schema';

/** A screenshot the shell captured (or edited) and imported as a resource. */
export interface Screenshot {
  file: FileRef;
  /**
   * The Markdown screen context the shell imported beside a capture (app, window, picked element,
   * recognised text); null when it had nothing to write, and always null for an edit.
   */
  context: FileRef | null;
  capturedAt: string;
}

/**
 * How the shell names a capture's context file: the image's date stem plus this suffix
 * (`Screenshot <date> context.md`, written by the Swift capture). The name is what marks the file
 * as the capture's own context once it sits in an input, since inputs carry no other marker.
 */
const CONTEXT_SUFFIX = ' context.md';

/** Whether `file` is a capture's screen context, by the name the shell gives it. */
export function isCaptureContext(file: FileRef): boolean {
  return !isImageMime(file.type) && file.name.endsWith(CONTEXT_SUFFIX);
}

/**
 * The screenshot a screenshot command's input carries: its first file while `capturedAt` is set.
 * Capturing puts the image first (its context, if any, right after it) and stamps the time, and
 * the input page lists only the other files for removal, so they are never mistaken for the capture.
 */
export function screenshotOf(input: TaskInput): FileRef | undefined {
  return input.source === 'screenshot' && input.capturedAt ? input.files[0] : undefined;
}

/**
 * The capture's context file: the file right after the screenshot, when it carries the shell's
 * context name. An edit keeps it; a retake replaces it; the user may remove it like any file.
 */
export function screenshotContextOf(input: TaskInput): FileRef | undefined {
  const next = screenshotOf(input) && input.files[1];
  return next && isCaptureContext(next) ? next : undefined;
}

/**
 * `input` with `shot` as its screenshot, replacing an earlier capture and its context but no other
 * file. The context follows the image only while the attachment limit leaves room for it.
 */
export function withScreenshot(input: TaskInput, shot: Screenshot): TaskInput {
  const previous = [screenshotOf(input), screenshotContextOf(input)];
  const others = input.files.filter((file) => !previous.includes(file));
  const context = shot.context && others.length + 2 <= MAX_ATTACHMENTS ? [shot.context] : [];
  return {
    ...input,
    source: 'screenshot',
    capturedAt: shot.capturedAt,
    files: [shot.file, ...context, ...others],
  };
}

/** `files` with the file `id` replaced in place by `next` (an edited image), the others kept. */
export function replaceFile(files: FileRef[], id: string, next: FileRef): FileRef[] {
  return files.map((file) => (file.id === id ? next : file));
}

/** A screenshot input can run once it carries an image, the capture or an attached one. */
export function missingScreenshot(input: TaskInput): boolean {
  return input.source === 'screenshot' && !input.files.some((file) => isImageMime(file.type));
}
