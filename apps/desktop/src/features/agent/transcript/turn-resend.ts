import type { InputChip, InputChipRange, RunReference } from '@ai/agent-contracts';
import type { SubmitRequest } from '../../../client/agent/bridge';
import type { RunPolicy } from '../../../client/agent/run-policy';
import {
  emptyInput,
  type FileRef,
  type RunSnapshot,
  type TaskInput,
  type TaskRun,
} from '../../../client/agent/task-schema';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import {
  draftChips,
  draftFiles,
  draftReferences,
  draftSkills,
  type Chip,
  type ChipRange,
} from '../../composer-editor/draft';
import { promptChipRanges } from './composed-prompt';

/**
 * Edit-and-resend and regenerate: the submit that replaces a user message of the task. The
 * service branches the session before `branchBefore`, so the message and everything after it
 * leave the transcript, and the new run prompts in its place.
 */

/**
 * The text a message can be edited as: a run prompt's composed input (chip tokens included, so
 * they can be found again), the plain message for a queued follow-up or an instruction run.
 */
export function editableText(user: BlockOf<'user'>, run: TaskRun | undefined): string {
  return run && !run.snapshot.instructions ? run.snapshot.input.text : user.text;
}

/** The message as the user would copy it. */
export function promptText(user: BlockOf<'user'>, run: TaskRun | undefined): string {
  return editableText(user, run).trim() || user.text;
}

/** A chip token edited into a longer word (`@notes` into `@notes2`) is that word, not the chip. */
function findToken(text: string, token: string, from: number): number {
  for (let at = text.indexOf(token, from); at >= 0; at = text.indexOf(token, at + 1))
    if (!/[\p{L}\p{N}_-]/u.test(text.charAt(at + token.length))) return at;
  return -1;
}

/**
 * Moves each chip to where its token now sits in `next`, in order. Ranges index the text they
 * were recorded with, so none is sent unchanged: a chip whose token the edit removed is dropped,
 * and with it the skill or reference it staged. Its file, if any, stays attached.
 */
function relocate(text: string, next: string, ranges: readonly InputChipRange[]): InputChipRange[] {
  const moved: InputChipRange[] = [];
  let at = 0;
  for (const range of ranges) {
    const token = text.slice(range.from, range.to);
    const from = token ? findToken(next, token, at) : -1;
    if (from < 0) continue;
    moved.push({ from, to: from + token.length, chip: range.chip });
    at = from + token.length;
  }
  return moved;
}

/** The composer chip a recorded chip stands for; a file chip needs the run's file record. */
function composerChip(chip: InputChip, files: readonly FileRef[]): Chip | null {
  switch (chip.kind) {
    case 'file': {
      const file = files.find((item) => item.id === chip.fileId);
      return file ? { kind: 'file', file } : null;
    }
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
 * The policy the run was frozen with: its model, thinking level, tools and memory, plus the
 * skills and references its remaining chips stage. MCP tool picks and roles are not part of the
 * run snapshot, so a resend runs with the task's defaults for those.
 */
function runPolicy(snapshot: RunSnapshot, skills: string[], references: RunReference[]): RunPolicy {
  return {
    tools: snapshot.tools,
    memory: snapshot.memory,
    confirmExpansion: false,
    model: { connectionId: snapshot.model.connectionId, modelId: snapshot.model.modelId },
    ...(snapshot.thinkingLevel ? { thinkingLevel: snapshot.thinkingLevel } : {}),
    ...(skills.length ? { skills: skills.map((name) => ({ name })) } : {}),
    ...(references.length ? { references } : {}),
  };
}

/** A run prompt resent as `text`: the run's input and policy, chips moved to the new text. */
function promptResend(
  snapshot: RunSnapshot,
  text: string,
): Pick<SubmitRequest, 'input' | 'policy'> {
  const base = snapshot.input;
  const ranges = snapshot.instructions ? [] : relocate(base.text, text, promptChipRanges(snapshot));
  const chips = ranges.flatMap(({ from, to, chip }): ChipRange[] => {
    const draft = composerChip(chip, base.files);
    return draft ? [{ from, to, chip: draft }] : [];
  });
  // Every file of the run stays attached, including those whose chip the edit removed.
  const draft = { text, files: base.files, chips };
  const input: TaskInput = { ...base, text, files: draftFiles(draft), chips: draftChips(draft) };
  return { input, policy: runPolicy(snapshot, draftSkills(draft), draftReferences(draft)) };
}

/**
 * The submit that replaces `user` (which must carry its `entryId`) with `text`. A run prompt keeps
 * its run's files, selection, arguments, model, thinking, tools and memory; a queued follow-up is
 * resent as text only, on the model and tools of the run it was delivered to.
 */
export function replacementRequest(
  taskId: string,
  user: BlockOf<'user'> & { entryId: string },
  runs: readonly TaskRun[],
  run: TaskRun | undefined,
  text: string,
): Omit<SubmitRequest, 'action'> {
  const delivered = runs.find((item) => item.id === user.runId);
  const resend = run
    ? promptResend(run.snapshot, text)
    : {
        input: { ...emptyInput(), text, chips: [] },
        policy: delivered ? runPolicy(delivered.snapshot, [], []) : null,
      };
  return {
    invocationId: crypto.randomUUID(),
    taskId,
    commandId: null,
    commandRevision: null,
    savedRun: null,
    branchBefore: user.entryId,
    ...resend,
  };
}

/** Whether a replacement would send anything: text, or files the run keeps. */
export function canResend(text: string, run: TaskRun | undefined): boolean {
  return text.trim() !== '' || (run?.snapshot.input.files.length ?? 0) > 0;
}
