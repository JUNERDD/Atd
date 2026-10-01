import {
  quoteLabel,
  type InputChip,
  type InputChipRange,
  type MAX_INPUT_CHIPS,
  type MAX_QUOTE_CHARS,
  type MAX_RUN_REFERENCES,
  type MAX_RUN_SKILLS,
  type QuoteSource,
  type RunReference,
} from '@ai/agent-contracts';
import type { FileRef } from '../../client/agent/task-schema';

/**
 * One inline chip, inserted from the quick panel or (a quote, holding the Markdown of a passage
 * selected in an answer) from the transcript; the draft's only source of truth for it.
 */
export type Chip =
  | { kind: 'file'; file: FileRef }
  | { kind: 'task'; taskId: string; title: string }
  | { kind: 'mcpServer'; serverId: string }
  | { kind: 'agent'; name: string }
  | { kind: 'skill'; name: string }
  | { kind: 'quote'; text: string; source?: QuoteSource };

/** A chip and its token range in the serialized `text`. */
export interface ChipRange {
  from: number;
  to: number;
  chip: Chip;
}

export interface ComposerDraft {
  text: string;
  files: FileRef[];
  chips: ChipRange[];
}

/** Draft content in document order: plain text runs and chips. */
export type DraftSegment = string | Chip;

/**
 * How the service read a skill before messages carried chip records: a leading `/skill:` with a
 * valid skill name, followed by a space.
 */
const LEGACY_SKILL_PREFIX = /^\/skill:([A-Za-z0-9][A-Za-z0-9_-]*) /;

/** The contracts' caps, type-checked against them without importing the contracts at runtime. */
const MAX_REFERENCES: typeof MAX_RUN_REFERENCES = 16;
const MAX_SKILLS: typeof MAX_RUN_SKILLS = 32;
const MAX_CHIPS: typeof MAX_INPUT_CHIPS = 64;
const MAX_QUOTE: typeof MAX_QUOTE_CHARS = 12000;

export function chipName(chip: Chip): string {
  switch (chip.kind) {
    case 'file':
      return chip.file.name;
    case 'task':
      return chip.title;
    case 'mcpServer':
      return chip.serverId;
    case 'agent':
    case 'skill':
      return chip.name;
    case 'quote':
      return quoteLabel(chip.text);
  }
}

/** Identity of the referenced item, independent of its display name. */
function chipKey(chip: Chip): string {
  switch (chip.kind) {
    case 'file':
      return `file:${chip.file.id}`;
    case 'task':
      return `task:${chip.taskId}`;
    case 'mcpServer':
      return `mcpServer:${chip.serverId}`;
    case 'agent':
    case 'skill':
      return `${chip.kind}:${chip.name}`;
    case 'quote':
      return `quote:${chip.text}`;
  }
}

/**
 * Serialized chip text: a skill reads as `/skill:<name>`, every other chip as `@<name>`, quoted
 * when the name contains whitespace. The text around a chip, separating spaces included, belongs
 * to the document.
 */
export function chipText(chip: Chip): string {
  if (chip.kind === 'skill') return `/skill:${chip.name}`;
  const name = chipName(chip);
  return /\s/.test(name) ? `@"${name}"` : `@${name}`;
}

export function serialize(segments: readonly DraftSegment[], files: FileRef[]): ComposerDraft {
  let text = '';
  const chips: ChipRange[] = [];
  for (const segment of segments) {
    if (typeof segment === 'string') {
      text += segment;
      continue;
    }
    const serialized = chipText(segment);
    chips.push({ from: text.length, to: text.length + serialized.length, chip: segment });
    text += serialized;
  }
  return { text, files, chips };
}

export function deserialize(draft: ComposerDraft): DraftSegment[] {
  const { text, chips } = normalizeDraft(draft);
  const segments: DraftSegment[] = [];
  let at = 0;
  for (const { from, to, chip } of chips) {
    if (from > at) segments.push(text.slice(at, from));
    segments.push(chip);
    at = to;
  }
  if (at < text.length) segments.push(text.slice(at));
  return segments;
}

/**
 * Keeps the chips whose text still equals their serialized token, in order and without overlap.
 * Plain-text changes made outside the editor (clearing after a send, re-joining queued text)
 * therefore drop exactly the chips they broke.
 */
export function normalizeDraft(draft: ComposerDraft): ComposerDraft {
  let end = 0;
  const chips = [...draft.chips]
    .sort((a, b) => a.from - b.from)
    .filter(({ from, to, chip }) => {
      const valid = from >= end && draft.text.slice(from, to) === chipText(chip);
      if (valid) end = to;
      return valid;
    });
  const unchanged =
    chips.length === draft.chips.length &&
    chips.every((range, index) => range === draft.chips[index]);
  return unchanged ? draft : { ...draft, chips };
}

/**
 * Legacy-bubble parser for the text of a run sent before messages carried chip records: the
 * leading `/skill:<name> ` the service ran as a skill becomes that skill chip, over
 * `/skill:<name>` only, so the separating space stays text.
 */
export function seedFromText(text: string): ComposerDraft {
  const name = LEGACY_SKILL_PREFIX.exec(text)?.[1];
  const chip: Chip | null = name ? { kind: 'skill', name } : null;
  return { text, files: [], chips: chip ? [{ from: 0, to: chipText(chip).length, chip }] : [] };
}

/** Whether two drafts hold the same editor content; attachments live outside the editor. */
export function sameContent(a: ComposerDraft, b: ComposerDraft): boolean {
  return (
    a.text === b.text &&
    a.chips.length === b.chips.length &&
    a.chips.every((range, index) => {
      const other = b.chips[index];
      return (
        other !== undefined &&
        other.from === range.from &&
        other.to === range.to &&
        chipKey(other.chip) === chipKey(range.chip)
      );
    })
  );
}

/** Files sent with the draft: the attachment row, then file chips, each file once. */
export function draftFiles(draft: ComposerDraft): FileRef[] {
  const files = [...draft.files];
  for (const { chip } of draft.chips)
    if (chip.kind === 'file' && !files.some((file) => file.id === chip.file.id))
      files.push(chip.file);
  return files;
}

/**
 * Skill names of the draft's skill chips, each once, in draft order, up to the contract's cap.
 * Submit stages them as `policy.skills`, so a chip repeated in the text loads its skill once.
 */
export function draftSkills(draft: ComposerDraft): string[] {
  const names = new Set<string>();
  for (const { chip } of draft.chips) if (chip.kind === 'skill') names.add(chip.name);
  return [...names].slice(0, MAX_SKILLS);
}

function referenceOf(chip: Chip): RunReference | null {
  switch (chip.kind) {
    case 'task':
      return { kind: 'task', taskId: chip.taskId };
    case 'mcpServer':
      return { kind: 'mcpServer', serverId: chip.serverId };
    case 'agent':
      return { kind: 'agent', name: chip.name };
    case 'file':
    case 'skill':
    case 'quote':
      return null;
  }
}

/**
 * Run references for the conversation, MCP server and subagent chips, each item once, in draft
 * order, up to the contract's cap. Submit stages them, so deleting a chip drops its reference.
 */
export function draftReferences(draft: ComposerDraft): RunReference[] {
  const references = new Map<string, RunReference>();
  for (const { chip } of draft.chips) {
    const reference = referenceOf(chip);
    if (reference && !references.has(chipKey(chip))) references.set(chipKey(chip), reference);
  }
  return [...references.values()].slice(0, MAX_REFERENCES);
}

/** What the transcript needs to show a chip again: its kind, what it names, and the item's id. */
function inputChipOf(chip: Chip): InputChip {
  switch (chip.kind) {
    case 'file':
      return { kind: 'file', fileId: chip.file.id, name: chip.file.name };
    case 'task':
      return { kind: 'task', taskId: chip.taskId, title: chip.title };
    case 'mcpServer':
      return { kind: 'mcpServer', serverId: chip.serverId };
    case 'agent':
      return { kind: 'agent', name: chip.name };
    case 'skill':
      return { kind: 'skill', name: chip.name };
    case 'quote':
      return chip.source
        ? { kind: 'quote', text: chip.text, source: chip.source }
        : { kind: 'quote', text: chip.text };
  }
}

/**
 * Chip records for `input.chips`: each chip's range in `draft.text`, in draft order, up to the
 * contract's cap. They let the transcript and the title show chips (a chip past the cap shows as
 * its text); files, skills and references still reach the run through `files` and staging, while
 * a quote's passage reaches it only through its record.
 */
export function draftChips(draft: ComposerDraft): InputChipRange[] {
  return draft.chips
    .slice(0, MAX_CHIPS)
    .map(({ from, to, chip }) => ({ from, to, chip: inputChipOf(chip) }));
}

/**
 * A quote chip for `markdown`, cut to the contract's cap with an ellipsis: a selection can span a
 * whole long answer, and the passage travels in the chip record rather than the text. `source`
 * lets the chip show where it was taken from.
 */
export function quoteChip(markdown: string, source?: QuoteSource): Chip {
  const text =
    markdown.length > MAX_QUOTE ? `${markdown.slice(0, MAX_QUOTE - 1).trimEnd()}…` : markdown;
  return source ? { kind: 'quote', text, source } : { kind: 'quote', text };
}

/** `draft` with `chip` appended after its text, apart from it, and a space to type after. */
export function appendChip(draft: ComposerDraft, chip: Chip): ComposerDraft {
  const segments = deserialize(draft);
  const last = segments.at(-1);
  const apart = last === undefined || (typeof last === 'string' && /\s$/.test(last));
  return serialize([...segments, ...(apart ? [] : [' ']), chip, ' '], draft.files);
}
