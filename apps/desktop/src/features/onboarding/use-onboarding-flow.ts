import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isComposingKey } from '@atd/ui/lib/ime';
import {
  ONBOARDING_STEPS,
  isGoalStep,
  type OnboardingGoals,
  type OnboardingStepId,
} from './onboarding-types';

export { ONBOARDING_STEPS, type OnboardingStepId };

const LAST = ONBOARDING_STEPS.length - 1;

/** Short step names (progress tooltips, announcements), as literal keys for type checking. */
export const STEP_NAME_KEYS = {
  welcome: 'chrome.stepNames.welcome',
  hotkey: 'chrome.stepNames.hotkey',
  selection: 'chrome.stepNames.selection',
  screenshot: 'chrome.stepNames.screenshot',
  provider: 'chrome.stepNames.provider',
  finish: 'chrome.stepNames.finish',
} as const satisfies Record<OnboardingStepId, `chrome.stepNames.${OnboardingStepId}`>;

/**
 * Where the guide is: the shown step, the direction of the last move (1 forward, -1 back) for the
 * slide, the furthest step reached (progress jumps only to visited steps, or the next one), and
 * whether the user has moved yet (the first move starts step announcements).
 */
export function useOnboardingFlow() {
  const [state, setState] = useState({ index: 0, direction: 1, furthest: 0, moved: false });

  function goTo(target: number) {
    setState((current) => {
      if (target === current.index || target < 0 || target > Math.min(current.furthest + 1, LAST))
        return current;
      return {
        index: target,
        direction: target > current.index ? 1 : -1,
        furthest: Math.max(current.furthest, target),
        moved: true,
      };
    });
  }

  const step = ONBOARDING_STEPS[state.index] ?? 'welcome';
  return {
    ...state,
    step,
    isLast: state.index === LAST,
    next: () => goTo(state.index + 1),
    back: () => goTo(state.index - 1),
    goTo,
    goToStep: (target: OnboardingStepId) => goTo(ONBOARDING_STEPS.indexOf(target)),
  };
}

/** Whether the step waits on its goal: the primary is disabled and Later moves on instead. */
export function isGoalPending(step: OnboardingStepId, goals: OnboardingGoals) {
  return isGoalStep(step) && !goals[step];
}

/** Controls that use Return themselves: it must not also run the guide's primary action. */
export const OWNS_RETURN = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="dialog"]',
].join(',');

/**
 * Return runs the step's primary action while `enabled` (the card has settled and the primary is
 * not waiting on a goal), unless focus is in a control that uses Return itself (the recorder, a
 * select, a switch, any button) or an IME is composing.
 */
export function usePrimaryShortcut(action: () => void, enabled: boolean) {
  const run = useEffectEvent(action);
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isComposingKey(event)) return;
      if (event.target instanceof Element && event.target.closest(OWNS_RETURN)) return;
      event.preventDefault();
      run();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * The polite live region's text: "Step N of M" after each move. A goal turning met is announced by
 * the step's own status output, so it is not repeated here.
 */
export function useStepAnnouncement(index: number, moved: boolean) {
  const { t } = useTranslation('onboarding');
  return moved
    ? t('chrome.stepAnnouncement', { current: index + 1, total: ONBOARDING_STEPS.length })
    : '';
}

/** Closes the guide; `summon` then shows the panel. */
export function closeOnboarding(summon: boolean) {
  return window.desktop?.onboarding?.close(summon) ?? Promise.resolve();
}

/** Tells the shell the intro is over, so the window drops below the menu bar and Dock. */
export function settleOnboarding() {
  return window.desktop?.onboarding?.settle() ?? Promise.resolve();
}
