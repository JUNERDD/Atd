import {
  isImagePoint,
  stepEffect,
  type ActionResult,
  type ComputerDetails,
  type ComputerError,
  type ComputerPointLocator,
  type ComputerStep,
  type ComputerVisualState,
  type Observation,
} from '@atd/agent-contracts';
import { ocrTextRef } from './ocr-locators.js';

/** Characters of one step summary (`ComputerDetails.steps[].summary`). */
const SUMMARY_CHARS = 200;

function clip(text: string, limit = SUMMARY_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** A locator as a person reads it: an element ref, its semantic fields, or a capture point. */
function locatorText(locator: ComputerPointLocator): string {
  if (isImagePoint(locator)) return `point ${locator.x},${locator.y} of capture ${locator.capture}`;
  if ('ref' in locator) return `element ${locator.ref}`;
  const parts = [locator.role, locator.label ?? locator.name, locator.placeholder, locator.text];
  return parts.filter(Boolean).join(' ') || 'element';
}

function within(locator: ComputerPointLocator | undefined, word: string): string {
  return locator ? ` ${word} ${locatorText(locator)}` : '';
}

/**
 * One step in a few words for the transcript, audit and confirm. Text a step types is never
 * included, only its length, since it may be a password or private content.
 */
export function stepSummary(step: ComputerStep): string {
  switch (step.kind) {
    case 'navigate':
      return clip(`Open ${step.url}`);
    case 'fill':
    case 'setValue':
      return clip(`Type ${step.text.length} characters into ${locatorText(step.locator)}`);
    case 'press':
      return clip(
        `${step.effect === 'submit' ? 'Submit with' : 'Click'} ${locatorText(step.locator)}`,
      );
    case 'scroll':
      return clip(`Scroll ${step.direction} ${step.amount}${within(step.locator, 'in')}`);
    case 'wait':
      return clip(`Wait until ${step.condition.kind}`);
    case 'click': {
      const verb =
        step.count === 2 ? 'Double-click' : step.button === 'right' ? 'Right-click' : 'Click';
      return clip(`${verb} ${locatorText(step.locator)}`);
    }
    case 'key':
      return clip(
        `Press ${[...(step.modifiers ?? []), step.key].join('+')}${within(step.locator, 'in')}`,
      );
    case 'type':
      return clip(`Type ${step.text.length} characters${within(step.locator, 'into')}`);
    case 'clear':
      return clip(`Clear ${locatorText(step.locator)}`);
    case 'menu':
      return clip(`Choose the menu item ${step.path.join(' > ')}`);
    case 'drag':
      return clip(`Drag from ${locatorText(step.from)} to ${locatorText(step.to)}`);
    case 'select':
      return clip(`Choose "${step.option}" in ${locatorText(step.locator)}`);
    case 'upload':
      return clip(`Upload ${step.resourceIds.length} task file(s) to ${locatorText(step.locator)}`);
  }
}

/**
 * The transcript details of one call (projected by transcript-details/computer.ts). An action's
 * `result` carries what the host reported, its route, a refusal's `error.reason` and the
 * disturbances it measured included; `delivery` repeats how the host delivered it, when the result
 * says, so the transcript can mark a step the host completed in the foreground. `error` is the
 * refusal or failure of any other operation, such as an `observe` refused `needsConsent` or a
 * `requestAccess` refused `noBackgroundRoute` (`openBrowser`); an action never repeats its
 * result's error there. `blockedBy` names the earlier business actions whose unconfirmed outcome
 * held a refused `act` back, set only when there are any (policy.ts names at most
 * `COMPUTER_MAX_RESOLVE_IDS`, each once).
 */
export function computerDetails(fields: {
  op: ComputerDetails['op'];
  target?: string | undefined;
  bindingId?: string | undefined;
  actionId?: string | undefined;
  steps?: readonly ComputerStep[];
  result?: ActionResult | undefined;
  error?: ComputerError | undefined;
  blockedBy?: readonly string[] | undefined;
  visual?: ComputerVisualState | undefined;
  resourceIds?: readonly string[];
}): ComputerDetails {
  return {
    type: 'computer',
    op: fields.op,
    ...(fields.target ? { target: clip(fields.target, 120) } : {}),
    ...(fields.bindingId ? { bindingId: fields.bindingId } : {}),
    ...(fields.actionId ? { actionId: fields.actionId } : {}),
    steps: (fields.steps ?? []).map((step) => ({
      kind: step.kind,
      effect: stepEffect(step),
      summary: stepSummary(step),
    })),
    ...(fields.result ? { result: fields.result } : {}),
    ...(fields.result?.delivery ? { delivery: fields.result.delivery } : {}),
    ...(fields.error && fields.op !== 'act' ? { error: fields.error } : {}),
    ...(fields.blockedBy?.length ? { blockedBy: [...fields.blockedBy] } : {}),
    ...(fields.visual ? { visual: fields.visual } : {}),
    resourceIds: [...(fields.resourceIds ?? [])],
  };
}

/**
 * What the model reads of an observation: its identity, the surface it shows and the target's
 * other surfaces, page facts, actionable elements (with frames in capture pixels), the capture's
 * size and crop, recognized text boxes and what could not be relied on. The host already
 * truncated values and masked secrets; the screenshot travels as a resource only.
 */
export function observationFacts(observation: Observation): Record<string, unknown> {
  const { ref, url, title, elements, capabilities, capture } = observation;
  const { surfaceRefId, surfaces, treeCapturedAt, text, problems } = observation;
  return {
    observationRefId: ref.id,
    targetRefId: ref.targetRefId,
    version: ref.version,
    capturedAt: ref.capturedAt,
    ...(surfaceRefId ? { surfaceRefId } : {}),
    ...(surfaces?.length
      ? {
          surfaces: surfaces.map(({ id, parentId, kind, title, modal, basis }) => ({
            id,
            ...(parentId ? { parentId } : {}),
            kind,
            ...(title === undefined ? {} : { title }),
            modal,
            basis,
          })),
        }
      : {}),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(treeCapturedAt ? { treeCapturedAt } : {}),
    capabilities,
    elements,
    ...(observation.menuItems
      ? {
          menuItems: {
            enabled: observation.menuItems.filter((item) => item.enabled).map((item) => item.path),
            disabled: observation.menuItems
              .filter((item) => !item.enabled)
              .map((item) => item.path),
          },
        }
      : {}),
    ...(capture
      ? {
          capture: {
            id: capture.id,
            width: capture.width,
            height: capture.height,
            ...(capture.expiresAt ? { expiresAt: capture.expiresAt } : {}),
            ...(capture.crop ? { crop: capture.crop } : {}),
          },
        }
      : {}),
    ...(text?.length
      ? {
          // Every row keeps its complete ref and box; duplicate labels remain distinct. Null
          // confidence means the host supplied none. Geometry retains the prior display precision.
          text: {
            columns: ['ref', 'text', 'x', 'y', 'width', 'height', 'confidence'],
            rows: text.map(({ text, rect, confidence }, index) => [
              ocrTextRef(ref.id, index),
              text,
              Math.round(rect.x * 100) / 100,
              Math.round(rect.y * 100) / 100,
              Math.round(rect.width * 100) / 100,
              Math.round(rect.height * 100) / 100,
              confidence === undefined ? null : Math.round(confidence * 1000) / 1000,
            ]),
          },
        }
      : {}),
    ...(problems?.length ? { problems } : {}),
  };
}
