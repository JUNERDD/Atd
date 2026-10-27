import type { TaskInput } from '@atd/agent-contracts';
import { readableInputText } from './input-chips.js';

/** Short plain requests already make useful titles, regardless of the language they use. */
const DIRECT_TITLE_MAX_CODE_POINTS = 40;
const CONTENT_REFERENCE_KINDS = new Set(['file', 'folder', 'task', 'memory', 'quote']);

/**
 * Decide locally before saving a pending marker or opening a model. Length and structure identify
 * material that benefits from a summary; short names of skills, agents and apps remain direct.
 */
export function needsSummaryTitle(input: TaskInput): boolean {
  if (input.files.length || input.chips?.some(({ chip }) => CONTENT_REFERENCE_KINDS.has(chip.kind)))
    return true;
  const text = readableInputText(input).trim();
  if (!text) return false;
  return (
    Array.from(text).length > DIRECT_TITLE_MAX_CODE_POINTS ||
    // Chip labels are flattened for titles; keep the original request's line structure here.
    /[\r\n\u2028\u2029]/u.test(input.text.trim()) ||
    /\b(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S+/iu.test(text) ||
    /\[[^\]\r\n]+\](?:\([^\r\n)]*\)|\[[^\]\r\n]*\])/u.test(text) ||
    /`{3}|~{3}/u.test(text)
  );
}
