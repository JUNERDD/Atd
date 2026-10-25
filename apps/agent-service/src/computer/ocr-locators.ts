import {
  COMPUTER_ENGINE_FOR_KIND,
  type ComputerActionInput,
  type ComputerCondition,
  type ComputerPointLocator,
  type TargetRef,
} from '@atd/agent-contracts';
import { refuse, type CallContext } from './call-context.js';

/** A text alias belongs to one observed box; it never claims persistent element identity. */
export function ocrTextRef(observationRefId: string, index: number): string {
  return `ocr:${observationRefId}:${index}`;
}

function isOcrRef(locator: ComputerPointLocator | undefined): locator is { ref: string } {
  return locator !== undefined && 'ref' in locator && locator.ref.startsWith('ocr:');
}

/**
 * Validate native pointer refs against this run's latest operational observation. Keep the ref
 * so the native host can match both the observed text and its region against fresh pixels.
 */
export function resolveOcrLocators(
  ctx: CallContext,
  input: ComputerActionInput,
  target: TargetRef,
): ComputerActionInput {
  const known = { bindingId: target.bindingId };
  const rejectElement = (locator: ComputerPointLocator | undefined) => {
    if (isOcrRef(locator))
      refuse(
        ctx,
        'OCR refs support native click and drag only; they are not accessibility elements or condition locators. Nothing was sent.',
        known,
      );
  };
  const rejectCondition = (condition: ComputerCondition | undefined) => {
    if (condition && 'locator' in condition) rejectElement(condition.locator);
  };
  const pointer = (locator: ComputerPointLocator): ComputerPointLocator => {
    if (!isOcrRef(locator)) return locator;
    if (
      target.engine !== COMPUTER_ENGINE_FOR_KIND.native ||
      ctx.unattended ||
      ctx.scope.mode !== 'free'
    )
      refuse(
        ctx,
        'OCR refs are available only for attended native application clicks and drags; nothing was sent.',
        known,
      );
    const snapshot = ctx.runtime.coordinator.snapshots.get(
      ctx.runId,
      target.id,
      input.observationRefId,
      target.hostGeneration,
    );
    if (!snapshot || snapshot.observation.surfaceRefId !== input.surfaceRefId)
      refuse(
        ctx,
        'The OCR ref needs this run’s current observation of the same target and surface. Observe again; nothing was sent.',
        known,
      );
    const box = snapshot.observation.text?.find(
      (_, index) => ocrTextRef(snapshot.observation.ref.id, index) === locator.ref,
    );
    if (!box)
      refuse(
        ctx,
        'The OCR ref is not in this observation. Use a ref returned by its text entries; nothing was sent.',
        known,
      );
    return locator;
  };
  rejectCondition(input.postcondition);
  const steps = input.steps.map((step) => {
    if (step.kind === 'click') return { ...step, locator: pointer(step.locator) };
    if (step.kind === 'drag') return { ...step, from: pointer(step.from), to: pointer(step.to) };
    if ('locator' in step) rejectElement(step.locator);
    if (step.kind === 'wait') rejectCondition(step.condition);
    return step;
  });
  return { ...input, steps };
}
