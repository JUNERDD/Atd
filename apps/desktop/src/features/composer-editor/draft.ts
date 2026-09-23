import type { MAX_RUN_REFERENCES, RunReference } from '@ai/agent-contracts';
import type { FileRef } from '../../../electron/agent/task-schema';

/** One inline reference inserted from the quick panel; the draft's only source of truth for it. */
export type Chip =
  | { kind: 'file'; file: FileRef }
  | { kind: 'task'; taskId: string; title: string }
  | { kind: 'mcpServer'; serverId: string }
  | { kind: 'agent'; name: string }
  | { kind: 'skill'; name: string };

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

/** The service's `/skill:` rule (`skills/expansion.ts`): a valid name followed by a space. */
const SKILL_PREFIX = /^\/skill:([A-Za-z0-9][A-Za-z0-9_-]*) /;

/** The contract's cap, type-checked against it without importing the contracts at runtime. */
const MAX_REFERENCES: typeof MAX_RUN_REFERENCES = 16;

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
  }
}

/**
 * Serialized chip text. A skill chip owns its separating space because the service only expands
 * `/skill:<name> ` at the very start; every other chip reads as `@<name>`, quoted when the name
 * contains whitespace.
 */
export function chipText(chip: Chip): string {
  if (chip.kind === 'skill') return `/skill:${chip.name} `;
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
 * Keeps the chips whose text still equals their serialized token, in order and without overlap; a
 * skill chip counts only at the start. Plain-text changes made outside the editor (clearing after
 * a send, re-joining queued text) therefore drop exactly the chips they broke.
 */
export function normalizeDraft(draft: ComposerDraft): ComposerDraft {
  let end = 0;
  const chips = [...draft.chips]
    .sort((a, b) => a.from - b.from)
    .filter(({ from, to, chip }) => {
      const valid =
        from >= end &&
        draft.text.slice(from, to) === chipText(chip) &&
        (chip.kind !== 'skill' || from === 0);
      if (valid) end = to;
      return valid;
    });
  const unchanged =
    chips.length === draft.chips.length &&
    chips.every((range, index) => range === draft.chips[index]);
  return unchanged ? draft : { ...draft, chips };
}

/** A plain-text draft; a leading `/skill:<name> ` becomes the skill chip it stands for. */
export function seedFromText(text: string): ComposerDraft {
  const name = SKILL_PREFIX.exec(text)?.[1];
  return {
    text,
    files: [],
    chips: name ? [{ from: 0, to: `/skill:${name} `.length, chip: { kind: 'skill', name } }] : [],
  };
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

/** The skill chip's name; submit stages it as `policy.skills`, so the run follows the chip. */
export function draftSkill(draft: ComposerDraft): string | null {
  for (const { chip } of draft.chips) if (chip.kind === 'skill') return chip.name;
  return null;
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
