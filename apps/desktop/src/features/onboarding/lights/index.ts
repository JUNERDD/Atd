import type { OnboardingStepId } from '../onboarding-types';
import { APPS_LIGHT } from './apps';
import { FINISH_LIGHT } from './finish';
import { HOTKEY_LIGHT } from './hotkey';
import type { LightDesign } from './light-design';
import { PROVIDER_LIGHT } from './provider';
import { SCREENSHOT_LIGHT } from './screenshot';
import { SELECTION_LIGHT } from './selection';
import { WELCOME_LIGHT } from './welcome';

/** Each step's own light, behind its art in the card's art panel. */
export const STEP_LIGHTS: Record<OnboardingStepId, LightDesign> = {
  welcome: WELCOME_LIGHT,
  hotkey: HOTKEY_LIGHT,
  selection: SELECTION_LIGHT,
  screenshot: SCREENSHOT_LIGHT,
  provider: PROVIDER_LIGHT,
  apps: APPS_LIGHT,
  finish: FINISH_LIGHT,
};
