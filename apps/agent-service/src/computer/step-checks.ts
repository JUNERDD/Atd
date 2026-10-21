import {
  COMPUTER_STEP_KINDS_FOR_KIND,
  isImagePoint,
  stepEffect,
  type CapabilityProfile,
  type ComputerAction,
  type ComputerImagePoint,
  type ComputerLocateKind,
  type ComputerPointLocator,
  type ComputerStep,
  type TargetBinding,
  type TargetRef,
} from '@atd/agent-contracts';
import { originAllowed } from './bindings.js';
import { pointInCapture, type KnownCapture } from './captures.js';
import type { Refusal } from './recipe-step.js';

/*
 * What one action's steps may do on one target (contract spec D3): the effective set is the
 * binding's kind, the engine profile and the target ref's own capabilities. The host picks each
 * step's route and delivery; a step needs a delivery the request may use, `background`, or
 * `foreground` where the request lets the host fall back to it (foreground.ts), and the host
 * refuses one it finds none for when the step runs (`noBackgroundRoute`). Capture points must name
 * a capture the run observed of the same target and lie inside it. Part of the hard scope check
 * (policy.ts), before any approval.
 */

export interface StepScope {
  binding: TargetBinding;
  profile: CapabilityProfile;
  targetRef: TargetRef;
  /** A capture the run observed of this target ref, by id. */
  capture: (captureId: string) => KnownCapture | undefined;
  /**
   * Whether the request lets the host complete a step in the foreground when no background route
   * can (`ExecutionEnvelope.foregroundAllowed`, foreground.ts).
   */
  foregroundAllowed: boolean;
}

function refuse(message: string): Refusal {
  return { ok: false, message };
}

/** Every locator a step carries: elements, and capture points where the step takes them. */
function stepLocators(step: ComputerStep): readonly ComputerPointLocator[] {
  switch (step.kind) {
    case 'fill':
    case 'press':
    case 'setValue':
    case 'clear':
    case 'click':
    case 'select':
    case 'upload':
      return [step.locator];
    case 'scroll':
    case 'type':
    case 'key':
      return step.locator === undefined ? [] : [step.locator];
    case 'drag':
      return [step.from, step.to];
    case 'navigate':
    case 'wait':
    case 'menu':
      return [];
  }
}

function locateKind(locator: ComputerPointLocator): ComputerLocateKind {
  if (isImagePoint(locator)) return 'image';
  return 'ref' in locator ? 'element' : 'semantic';
}

/** Why a capture point cannot be sent, or null when the run observed it within the capture. */
function pointProblem(point: ComputerImagePoint, scope: StepScope): string | null {
  const capture = scope.capture(point.capture);
  if (!capture)
    return `Capture ${point.capture} is not one this run observed of this target: observe again with a screenshot.`;
  if (!pointInCapture(capture, point.x, point.y))
    return `Point ${point.x},${point.y} lies outside capture ${point.capture} (${capture.width}×${capture.height} pixels).`;
  return null;
}

/**
 * Checks one step against the target ref's published capabilities, when it has any: it needs a
 * delivery the request may use, so a step the host lists only for the foreground is unavailable
 * to a request that does not allow it.
 */
function targetAllows(step: ComputerStep, scope: StepScope): string | null {
  const { capabilities } = scope.targetRef;
  if (capabilities === undefined) return null;
  const entry = capabilities.find((item) => item.action === step.kind);
  const usable = entry?.delivery.some(
    (delivery) => delivery === 'background' || scope.foregroundAllowed,
  );
  if (!entry || !usable) return `This target cannot take the ${step.kind} step right now.`;
  for (const locator of stepLocators(step))
    if (!entry.locate.includes(locateKind(locator)))
      return `On this target the ${step.kind} step cannot locate by ${locateKind(locator)}.`;
  return null;
}

/**
 * The step kinds, effects, URLs and capture points of an action against the binding, the engine
 * profile and the target ref.
 */
export function stepsAllowed(action: ComputerAction, scope: StepScope): { ok: true } | Refusal {
  const { binding, profile } = scope;
  if (!profile.delivery.includes('background'))
    return refuse('The engine for this target cannot act in the background.');
  const kinds = COMPUTER_STEP_KINDS_FOR_KIND[binding.kind];
  for (const step of action.steps) {
    if (!kinds.includes(step.kind) || !profile.actions.includes(step.kind))
      return refuse(`A ${binding.kind} target does not support the ${step.kind} step here.`);
    if (!profile.effects.includes(stepEffect(step)))
      return refuse(`The engine does not allow the ${stepEffect(step)} effect.`);
    if (step.kind === 'navigate' && !originAllowed(binding, step.url))
      return refuse('That address is outside the origins this target allows.');
    const unsupported = targetAllows(step, scope);
    if (unsupported) return refuse(unsupported);
    for (const locator of stepLocators(step)) {
      const problem = isImagePoint(locator) ? pointProblem(locator, scope) : null;
      if (problem) return refuse(problem);
    }
  }
  return { ok: true };
}
