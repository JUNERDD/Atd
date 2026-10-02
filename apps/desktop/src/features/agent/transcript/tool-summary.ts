import type { BlockOf } from '../../../client/agent/transcript-schema';
import { diffStats, parseGrep, parseListing, parseReadNotice, splitNotice } from './tool-output';

/** What a counted summary counts; each maps to a pluralized `toolCount.*` string. */
export type SummaryUnit = 'match' | 'file' | 'item' | 'result' | 'page';

/**
 * The trailing fact a settled tool row shows beside its target, so rows of different tools read
 * differently at a glance:
 * - `diff`: lines added and removed (edit), or lines written (write, `removed` is 0).
 * - `range`: the line span a partial read returned.
 * - `count`: how many matches, files, entries, results, or pages came back.
 * - `empty`: the call succeeded and found nothing.
 */
export type ToolSummary =
  | { kind: 'diff'; added: number; removed: number }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'count'; unit: SummaryUnit; count: number }
  | { kind: 'empty'; unit: SummaryUnit };

/** Pi's grep sentence for an empty search (`core/tools/grep.js`). */
const NO_GREP_MATCHES = 'No matches found';

/**
 * The row summary of a call, or `null` when the tool has none or the call did not complete.
 * Failed, declined, and interrupted rows carry no summary, matching the rule that rows carry no
 * failure mark; running rows keep their one-line shimmer. Tool text is untrusted, so any shape
 * the parsers do not recognize yields no summary rather than a guess.
 */
export function toolSummary(block: BlockOf<'tool'>): ToolSummary | null {
  if (block.status !== 'completed') return null;
  const data = block.details.data;
  // Structured results first: they are already normalized by the service.
  if (data?.type === 'diff') return diffSummary(data.diff);
  if (data?.type === 'webSearch') return countSummary('result', data.results.length);
  if (data?.type === 'webFetch') {
    // One page is what the target already names; only a batch fetch says how many.
    return data.pages.length > 1 ? { kind: 'count', unit: 'page', count: data.pages.length } : null;
  }
  switch (block.name) {
    case 'edit':
      return diffSummary(block.details.diff);
    case 'write':
      return writeSummary(block.args.content);
    case 'read':
      return readRange(block.args, block.output);
    case 'grep':
      return grepSummary(block.output);
    case 'find':
      return listingSummary('file', block.output);
    case 'ls':
      return listingSummary('item', block.output);
    default:
      return null;
  }
}

function diffSummary(diff: string): ToolSummary | null {
  const { added, removed } = diffStats(diff);
  return added > 0 || removed > 0 ? { kind: 'diff', added, removed } : null;
}

/** Lines of the written content; a final newline ends the last line rather than starting one. */
function writeSummary(content: unknown): ToolSummary | null {
  if (typeof content !== 'string' || content === '') return null;
  const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
  return lines > 0 ? { kind: 'diff', added: lines, removed: 0 } : null;
}

/**
 * The lines a partial read returned, so the row and the card name the same span: Pi's notice when
 * it truncated, else the requested start plus the lines that came back. A whole-file read that was
 * not cut short has no range; `offset` is 1-indexed.
 */
function readRange(args: Record<string, unknown>, output: string): ToolSummary | null {
  const { body, notice } = splitNotice(output);
  const parsed = notice ? parseReadNotice(notice) : null;
  if (parsed?.kind === 'showing') return { kind: 'range', start: parsed.start, end: parsed.end };
  const offset = positiveInteger(args.offset);
  if (offset === null && positiveInteger(args.limit) === null && !parsed) return null;
  const start = offset ?? 1;
  const lines = body.replace(/\r?\n$/, '').split('\n').length;
  return { kind: 'range', start, end: start + lines - 1 };
}

function grepSummary(output: string): ToolSummary | null {
  if (splitNotice(output).body.trim() === NO_GREP_MATCHES) return { kind: 'empty', unit: 'match' };
  const parsed = parseGrep(output);
  return parsed && parsed.matchCount > 0 ? countSummary('match', parsed.matchCount) : null;
}

function listingSummary(unit: SummaryUnit, output: string): ToolSummary {
  return countSummary(unit, parseListing(output).entries.length);
}

function countSummary(unit: SummaryUnit, count: number): ToolSummary {
  return count > 0 ? { kind: 'count', unit, count } : { kind: 'empty', unit };
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
