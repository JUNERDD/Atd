import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { EDIT_DIFF_MAX_LENGTH, type EditDiffDetails } from '@ai/agent-contracts';
import { createClamp } from './clamp.js';

/**
 * Pi's `EditToolDetails` (pi-coding-agent core/tools/edit.ts). `diff` is Pi's display diff: one
 * line per change as `+<n> text`, `-<n> text`, or ` <n> text` with a padded line number and no
 * file or hunk headers. The unified `patch` stays in the session.
 */
const RawEditDetailsValidator = Compile(
  Type.Object({
    diff: Type.String(),
    firstChangedLine: Type.Optional(Type.Unknown()),
  }),
);

export function projectEditDetails(raw: unknown): EditDiffDetails | undefined {
  if (!RawEditDetailsValidator.Check(raw) || !raw.diff) return undefined;
  const clamp = createClamp();
  let diff = clamp.text(raw.diff, EDIT_DIFF_MAX_LENGTH);
  // A clamped diff ends on the last whole line so no row renders half a change.
  if (clamp.truncated) {
    const lastBreak = diff.lastIndexOf('\n');
    if (lastBreak > 0) diff = diff.slice(0, lastBreak);
  }
  const line = raw.firstChangedLine;
  return {
    type: 'diff',
    diff,
    ...(typeof line === 'number' && Number.isInteger(line) && line >= 1
      ? { firstChangedLine: line }
      : {}),
    truncated: clamp.truncated,
  };
}
