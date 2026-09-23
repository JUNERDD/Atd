import {
  StateEffect,
  StateField,
  type EditorState,
  type Text,
  type Transaction,
} from '@codemirror/state';
import type { FileRef } from '../../../electron/agent/task-schema';
import {
  chipText,
  deserialize,
  serialize,
  type Chip,
  type ComposerDraft,
  type DraftSegment,
} from './draft';

/**
 * The editor document stores each chip as one opaque token, `\uE000<id>\uE001`, built from
 * private-use characters that pasted or typed text never carries (the clipboard filter strips
 * them). Chip data lives in `chipTable` under the id, so undo, redo and copy only move text.
 */
const OPEN = '\uE000';
const CLOSE = '\uE001';
const TOKEN = /\uE000([0-9a-z]+)\uE001/g;
export const SENTINELS = /[\uE000\uE001]/g;

export interface ChipEntry {
  id: string;
  chip: Chip;
}

let lastId = 0;

/** Registers a chip under a fresh id; ids stay unique for the renderer's lifetime. */
export function chipEntry(chip: Chip): ChipEntry {
  lastId += 1;
  return { id: lastId.toString(36), chip };
}

export function tokenOf(id: string): string {
  return `${OPEN}${id}${CLOSE}`;
}

export const addChips = StateEffect.define<readonly ChipEntry[]>();

/** Chip data by token id. Entries are never removed, so undo can bring a deleted token back. */
export const chipTable = StateField.define<ReadonlyMap<string, Chip>>({
  create: () => new Map(),
  update(table, transaction) {
    let next = table;
    for (const effect of transaction.effects) {
      if (!effect.is(addChips)) continue;
      const added = new Map(next);
      for (const { id, chip } of effect.value) added.set(id, chip);
      next = added;
    }
    return next;
  },
});

/** Each known token in `text`, in document order. */
export function* chipTokens(text: string, table: ReadonlyMap<string, Chip>) {
  for (const match of text.matchAll(TOKEN)) {
    const id = match[1] ?? '';
    const chip = table.get(id);
    if (chip) yield { from: match.index, to: match.index + match[0].length, id, chip };
  }
}

/** Document text plus chip entries for a draft, used to build a fresh editor state. */
export function draftDocument(draft: ComposerDraft): { doc: string; entries: ChipEntry[] } {
  let doc = '';
  const entries: ChipEntry[] = [];
  for (const segment of deserialize(draft)) {
    if (typeof segment === 'string') {
      doc += segment.replace(SENTINELS, '');
      continue;
    }
    const entry = chipEntry(segment);
    entries.push(entry);
    doc += tokenOf(entry.id);
  }
  return { doc, entries };
}

/** Draft segments of document text; unknown tokens and stray sentinels are dropped. */
function segmentsOf(text: string, table: ReadonlyMap<string, Chip>): DraftSegment[] {
  const segments: DraftSegment[] = [];
  let at = 0;
  for (const { from, to, chip } of chipTokens(text, table)) {
    if (from > at) segments.push(text.slice(at, from).replace(SENTINELS, ''));
    segments.push(chip);
    at = to;
  }
  if (at < text.length) segments.push(text.slice(at).replace(SENTINELS, ''));
  return segments;
}

/** The serialized draft of an editor state; attachments come from the caller. */
export function editorDraft(state: EditorState, files: FileRef[]): ComposerDraft {
  return serialize(segmentsOf(state.doc.toString(), state.field(chipTable)), files);
}

/** Document text with every token written as its chip's serialized text. */
export function plainText(text: string, table: ReadonlyMap<string, Chip>): string {
  return serialize(segmentsOf(text, table), []).text;
}

export function hasToken(text: string): boolean {
  return text.includes(OPEN);
}

/** The chip table after a transaction, computing the new state only when chips were added. */
export function tableAfter(transaction: Transaction): ReadonlyMap<string, Chip> {
  return transaction.effects.some((effect) => effect.is(addChips))
    ? transaction.state.field(chipTable)
    : transaction.startState.field(chipTable);
}

/** Serialized length of `doc` between `from` and `to`, which is what the IPC limits count. */
export function serializedLength(
  doc: Text,
  table: ReadonlyMap<string, Chip>,
  from = 0,
  to = doc.length,
): number {
  return segmentsOf(doc.sliceString(from, to), table).reduce(
    (length, segment) =>
      length + (typeof segment === 'string' ? segment.length : chipText(segment).length),
    0,
  );
}
