import {
  COMPUTER_IMAGE_PIPELINE_VERSION,
  COMPUTER_TOOL_SCHEMA_VERSION,
  type ComputerVisualQualification,
  type ComputerVisualState,
} from '@atd/agent-contracts';

/*
 * Visual qualification of the run's model (plan §5.3, contract spec §8): whether it may take
 * visual steps (`isVisualStep`, a capture point as a locator). Image input, a driver that can act
 * and a model that locates correctly are separate facts, so a model's advertised image support
 * alone never qualifies it; only a record in the code-owned table below does. Every action runs in
 * the background (docs/plans/2026-10-19-imperceptible-computer-use.md §3), so only a background
 * qualification counts.
 */

/**
 * The development override: a service started with `--development` and this set to `1` allows
 * visual steps of an `unverified` model, so qualification runs can be carried out. Every action
 * it allows is audited. A packaged service ignores it.
 */
export const VISUAL_QUALIFICATION_ENV = 'AI_COMPUTER_VISUAL_QUALIFICATION';

/**
 * Recorded provider/model qualifications earned through the native screenshot and action flows on
 * this tool schema (`COMPUTER_TOOL_SCHEMA_VERSION`) and image pipeline
 * (`COMPUTER_IMAGE_PIPELINE_VERSION`); a version change makes every older record stop matching.
 * None exists yet for background delivery, so capture-point steps are refused (`notQualified`)
 * outside the development override. The one earlier record qualified a model for foreground
 * delivery only, which protocol 8 removed.
 */
export const COMPUTER_VISUAL_QUALIFICATIONS: readonly ComputerVisualQualification[] = [];

/** The model a run talks to, as visual qualification judges it. */
export interface VisualSubject {
  /** The run's frozen provider and model id (`RunSnapshot.model`). */
  provider: string;
  model: string;
  /** Whether the session's model takes image input (the catalog's `input` lists `image`). */
  acceptsImages: boolean;
}

/** The record that qualifies `subject` for background visual steps, if any. */
export function visualQualification(
  subject: VisualSubject,
  table: readonly ComputerVisualQualification[] = COMPUTER_VISUAL_QUALIFICATIONS,
): ComputerVisualQualification | undefined {
  return table.find(
    (record) =>
      record.provider === subject.provider &&
      record.model === subject.model &&
      record.toolSchemaVersion === COMPUTER_TOOL_SCHEMA_VERSION &&
      record.imagePipelineVersion === COMPUTER_IMAGE_PIPELINE_VERSION &&
      record.modes.includes('background'),
  );
}

/**
 * The visual state of `subject`: `unavailable` without image input, `qualified` when a record
 * covers it, else `unverified`.
 */
export function visualState(subject: VisualSubject): ComputerVisualState {
  if (!subject.acceptsImages) return 'unavailable';
  return visualQualification(subject) ? 'qualified' : 'unverified';
}

/** Whether the development override is in force for this service process. */
export function visualOverrideEnabled(
  development: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return development && env[VISUAL_QUALIFICATION_ENV] === '1';
}
