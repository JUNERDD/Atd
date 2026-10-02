import { quoteLabel, type InputChip, type InputChipRange } from '@ai/agent-contracts';
import type { RunSnapshot } from '../../../client/agent/task-schema';
import { seedFromText } from '../../composer-editor/draft';

/** A sent message in document order: its plain text runs and the chips between them. */
export type SentSegment = string | InputChip;

/** The name a chip shows, in the composer and in the sent message. */
export function sentChipName(chip: InputChip): string {
  switch (chip.kind) {
    case 'file':
    case 'agent':
    case 'skill':
      return chip.name;
    case 'task':
      return chip.title;
    case 'mcpServer':
      return chip.serverId;
    case 'quote':
      return quoteLabel(chip.text);
  }
}

/**
 * The stored ranges that can be drawn: inside the text, in order, not overlapping. A range that
 * fails is skipped, so its token stays visible as the text it is. Tokens are not compared with the
 * composer's serialization: that is the editor's format, not the ledger's contract.
 */
function drawableRanges(text: string, ranges: readonly InputChipRange[]): InputChipRange[] {
  let end = 0;
  return [...ranges]
    .sort((a, b) => a.from - b.from)
    .filter(({ from, to }) => {
      const drawable = from >= end && from < to && to <= text.length;
      if (drawable) end = to;
      return drawable;
    });
}

/**
 * Runs sent before chips were recorded: the leading `/skill:<name>` token the composer wrote for a
 * skill chip becomes that chip again. The ledger kept the original text, so no migration is needed.
 */
function legacyRanges(text: string): InputChipRange[] {
  return seedFromText(text).chips.flatMap(({ from, to, chip }): InputChipRange[] =>
    chip.kind === 'skill' ? [{ from, to, chip: { kind: 'skill', name: chip.name } }] : [],
  );
}

/** Drops the blank ends the service trims before prompting; a chip at either end stays. */
function trimEnds(segments: SentSegment[]): SentSegment[] {
  const first = segments[0];
  if (typeof first === 'string') segments[0] = first.trimStart();
  const last = segments.at(-1);
  if (typeof last === 'string') segments[segments.length - 1] = last.trimEnd();
  return segments.filter((segment) => segment !== '');
}

/** The chips of a run's input text: its drawable recorded ranges, or the legacy skill token. */
export function promptChipRanges(snapshot: RunSnapshot): InputChipRange[] {
  const { text, chips } = snapshot.input;
  return chips ? drawableRanges(text, chips) : legacyRanges(text);
}

/**
 * A run's prompt the way it was composed: the input text split around its chips (recorded ranges,
 * or the legacy skill token for runs without them), without the blank ends the service trims.
 * Null when the run prompted with something else, which callers show as plain text: an instruction
 * (runs imported from the desktop app) or, for a blank text, the service's stand-in for the files.
 */
export function composedPrompt(snapshot: RunSnapshot): SentSegment[] | null {
  const { text } = snapshot.input;
  if (snapshot.instructions || !text.trim()) return null;
  const segments: SentSegment[] = [];
  let at = 0;
  for (const { from, to, chip } of promptChipRanges(snapshot)) {
    if (from > at) segments.push(text.slice(at, from));
    segments.push(chip);
    at = to;
  }
  if (at < text.length) segments.push(text.slice(at));
  return trimEnds(segments);
}
