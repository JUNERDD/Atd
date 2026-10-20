import { COMPUTER_ENGINE_FOR_KIND, type ComputerAction } from '@atd/agent-contracts';
import { rectInCapture } from './captures.js';
import type { ActCheck } from './policy.js';

/** Regions verify text from this action's native observation, never from another baseline. */
export function regionalConditionsProblem(
  action: Pick<ComputerAction, 'steps' | 'postcondition' | 'observationRefId' | 'surfaceRefId'>,
  check: ActCheck,
): string | null {
  const conditions = [
    ...action.steps.flatMap((step) => (step.kind === 'wait' ? [step.condition] : [])),
    ...(action.postcondition ? [action.postcondition] : []),
  ];
  for (const condition of conditions) {
    if (condition.kind !== 'newText' || !condition.region) continue;
    if (condition.locator)
      return 'newText accepts either a locator or a region, never both; nothing was sent.';
    if (
      check.binding.kind !== 'native' ||
      check.targetRef.engine !== COMPUTER_ENGINE_FOR_KIND.native ||
      check.unattended ||
      check.scope.mode !== 'free'
    )
      return 'A newText region is available only for attended native application actions; nothing was sent.';
    const capture = check.capture(condition.region.capture);
    if (!capture || capture.observationRefId !== action.observationRefId)
      return 'The newText region must name a capture from this action’s observation; observe again.';
    if (capture.surfaceRefId !== action.surfaceRefId)
      return 'The newText region must belong to the surface this action observes; nothing was sent.';
    if (!rectInCapture(capture, condition.region.rect))
      return 'The newText region lies outside its observation capture; nothing was sent.';
  }
  return null;
}
