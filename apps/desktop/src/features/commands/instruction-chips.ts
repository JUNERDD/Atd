import {
  instructionTokenText,
  parseInstructionTokens,
  type InstructionReference,
} from '@atd/agent-contracts';
import { ChangeSet, EditorState } from '@codemirror/state';
import {
  addChips,
  chipEntry,
  SENTINELS,
  tokenOf,
  type ChipEntry,
} from '../composer-editor/chip-state';
import { chipText, type Chip, type DraftSegment } from '../composer-editor/draft';

/**
 * Command instructions stay plain text in which skills, subagents, MCP servers and conversations
 * are typed tokens (`instruction-tokens.ts`). The instruction editor holds them as composer chips;
 * this module converts between the two forms.
 */

/** Title of a conversation by task id, when the snapshot has it; chips show the id otherwise. */
export type TaskTitles = (taskId: string) => string | undefined;

function referenceOf(chip: Chip): InstructionReference | null {
  switch (chip.kind) {
    case 'skill':
    case 'agent':
      return { kind: chip.kind, name: chip.name };
    case 'mcpServer':
      return { kind: 'mcpServer', serverId: chip.serverId };
    case 'task':
      return { kind: 'task', taskId: chip.taskId };
    case 'file':
    case 'folder':
    case 'quote':
    case 'command':
    case 'memory':
      return null;
  }
}

function chipOf(reference: InstructionReference, titles: TaskTitles): Chip {
  if (reference.kind !== 'task') return reference;
  // A title taken from a multi-line first message would break the one-line chip.
  const title = titles(reference.taskId)?.replace(/\s+/g, ' ').trim();
  return { kind: 'task', taskId: reference.taskId, title: title || reference.taskId };
}

/** Whether `token` reads back as exactly one token between these neighbouring characters. */
function parsesBetween(before: string, token: string, after: string): boolean {
  return parseInstructionTokens(`${before}${token}${after}`).some(
    ({ from, to }) => from === before.length && to === before.length + token.length,
  );
}

/**
 * Whether the instructions can hold this chip: its token must read back as the same item. Every
 * service identifier and qualified plugin item name (`<plugin>:<item>`) can; a name outside that
 * alphabet could not be referenced by a run anyway.
 */
export function isInstructionChip(chip: Chip): boolean {
  const reference = referenceOf(chip);
  return reference !== null && parsesBetween('', instructionTokenText(reference), '');
}

/**
 * The instructions text of editor segments: each chip as its token. A chip the user joined to a
 * word, or to another chip, is set apart by a space so that it still reads back as a token.
 * File, folder and quote chips never occur here (the `@` panel offers none); they would keep their
 * composer text.
 */
export function instructionText(segments: readonly DraftSegment[]): string {
  let text = '';
  segments.forEach((segment, index) => {
    if (typeof segment === 'string') {
      text += segment;
      return;
    }
    const reference = referenceOf(segment);
    const token = reference ? instructionTokenText(reference) : chipText(segment);
    const next = segments[index + 1];
    const lead = parsesBetween(text.slice(-1), token, '') ? '' : ' ';
    // The whole following text, not its first character: `:` followed by a name segment would
    // extend the token into a qualified `<plugin>:<item>` name.
    const trail = typeof next === 'string' && !parsesBetween('', token, next) ? ' ' : '';
    text += `${lead}${token}${trail}`;
  });
  return text;
}

/** Editor document text and chip entries for instructions text; tokens become chips. */
export function instructionDocument(
  text: string,
  titles: TaskTitles,
): { doc: string; entries: ChipEntry[] } {
  const clean = text.replace(SENTINELS, '');
  let doc = '';
  let at = 0;
  const entries: ChipEntry[] = [];
  for (const { from, to, reference } of parseInstructionTokens(clean)) {
    const entry = chipEntry(chipOf(reference, titles));
    entries.push(entry);
    doc += `${clean.slice(at, from)}${tokenOf(entry.id)}`;
    at = to;
  }
  return { doc: doc + clean.slice(at), entries };
}

/**
 * Pasted or dropped instruction tokens become chips, so what the editor shows matches what the
 * saved text means. Typed token text stays text until the instructions are loaded again: turning
 * it into a chip mid-word would fight the typing.
 */
export function pastedTokenChips(titles: TaskTitles) {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.isUserEvent('input.paste') && !transaction.isUserEvent('input.drop'))
      return transaction;
    const edits: { from: number; to: number; insert: string }[] = [];
    const entries: ChipEntry[] = [];
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      const converted = instructionDocument(inserted.toString(), titles);
      entries.push(...converted.entries);
      edits.push({ from, to, insert: converted.doc });
    });
    if (!entries.length) return transaction;
    const start = transaction.startState;
    const changes = ChangeSet.of(edits, start.doc.length);
    return {
      changes,
      selection: start.selection.map(changes, 1),
      effects: [...transaction.effects, addChips.of(entries)],
      scrollIntoView: transaction.scrollIntoView,
      userEvent: transaction.isUserEvent('input.drop') ? 'input.drop' : 'input.paste',
    };
  });
}
