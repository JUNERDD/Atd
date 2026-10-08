import type { ReactNode } from 'react';
import type { SettingsSnapshot } from '../../client/settings-contract';

import type { OnboardingStepId } from '@atd/agent-contracts';
export { ONBOARDING_STEPS, type OnboardingStepId } from '@atd/agent-contracts';

/**
 * Whether each interactive step's goal is met, read from the app's real state (a panel the hotkey
 * showed, the system's Accessibility grant, the Screen Recording grant this running app holds, a
 * ready default connection), never from the guide's own buttons. None of them sends anything to a model: the guide never spends the user's tokens. A step counts as done only
 * while its goal is met; Later moves on without it.
 */
export interface OnboardingGoals {
  hotkey: boolean;
  selection: boolean;
  screenshot: boolean;
  provider: boolean;
}
export type GoalStepId = keyof OnboardingGoals;

/** The steps that have a goal, in guide order; the finish step summarizes exactly these. */
export const GOAL_STEPS: readonly GoalStepId[] = ['hotkey', 'selection', 'screenshot', 'provider'];

export function isGoalStep(step: OnboardingStepId): step is GoalStepId {
  return GOAL_STEPS.some((goal) => goal === step);
}

/** What a step renders with. */
export interface StepRenderProps {
  snapshot: SettingsSnapshot | null;
  goals: OnboardingGoals;
  /** The step's heading takes focus when shown (every step after the first move). */
  focusHeading: boolean;
  /** The card is at rest: settled after its entrance, and not closing. */
  atRest: boolean;
  /** Save this step before macOS can quit the app to apply a permission. */
  saveProgress: () => Promise<void>;
  /** Shows another step: the finish step's way back to an unfinished one. */
  goTo: (step: OnboardingStepId) => void;
}

/** One step as the card lays it out. */
export interface OnboardingStepView {
  /** The left column: heading, description, the step's controls and its goal status. */
  content: ReactNode;
  /** The right column's artwork (decorative, as the content says the same, unless `artIsContent`). */
  art: ReactNode;
  /** The art is real content the user works with (the selection practice), not decoration. */
  artIsContent?: boolean;
  /** The primary button's label. */
  primaryLabel: string;
}
