import {
  isBusinessEffect,
  recipeStepEffect,
  type AutomationComputerPolicy,
  type ComputerCondition,
  type ComputerLocator,
  type ComputerRecipeStep,
  type ComputerTextConstraint,
  type ComputerTrial,
} from '@atd/agent-contracts';
import type { ComputerBindingSource } from './computer-deps.js';

/**
 * The computer scope of an automation in words, for the `automation` tool's confirmation (plan
 * §3.3): every target with what it may reach, every recipe step with the effect it may have, the
 * submit budget, the completion condition and where authorization stands, so the person approves
 * exactly what runs and never a bare "may click". English, like every confirm detail the service
 * writes. The shell's own confirmation renders the same scope from the approval details route.
 */

function locatorText(locator: ComputerLocator): string {
  if ('ref' in locator) return `element ${locator.ref}`;
  const parts = [
    locator.role,
    locator.name && `named "${locator.name}"`,
    locator.label && `labelled "${locator.label}"`,
    locator.placeholder && `with placeholder "${locator.placeholder}"`,
    locator.text && `showing "${locator.text}"`,
  ];
  return parts.filter(Boolean).join(' ');
}

export function conditionText(condition: ComputerCondition): string {
  switch (condition.kind) {
    case 'menuItemAvailable':
      return `the application menu item ${condition.path.join(' > ')} is available`;
    case 'enabled':
      return `${locatorText(condition.locator)} is enabled`;
    case 'valueEquals':
      return `${locatorText(condition.locator)} holds "${condition.text}"`;
    case 'textAppears':
      return `the text "${condition.text}" appears`;
    case 'urlMatches':
      return `the page address starts with ${condition.pattern}`;
    case 'newText': {
      const where = condition.locator ? ` in ${locatorText(condition.locator)}` : '';
      const shape = condition.pattern ? ` matching /${condition.pattern}/` : '';
      return `a new identifier appears${where}${shape}`;
    }
  }
}

function textRule(rule: ComputerTextConstraint): string {
  const parts = [`up to ${rule.maxLength} characters`];
  if (rule.pattern) parts.push(`matching /${rule.pattern}/`);
  if (rule.oneOf) parts.push(`one of ${rule.oneOf.map((item) => `"${item}"`).join(', ')}`);
  return parts.join(', ');
}

function stepDetail(step: ComputerRecipeStep): string {
  switch (step.kind) {
    case 'navigate':
      return `opens a page under ${step.urlPrefix}`;
    case 'fill':
    case 'setValue':
      return `enters text into ${locatorText(step.locator)} (${textRule(step.text)})`;
    case 'press':
      return `presses ${locatorText(step.locator)}`;
    case 'scroll':
      return step.locator ? `scrolls ${locatorText(step.locator)}` : 'scrolls the page';
    case 'wait':
      return `waits until ${conditionText(step.condition)}`;
  }
}

/**
 * The scope in words. `authorized`: a grant already covers it; `trial`: the passed trial that
 * would qualify a grant for it, if any.
 */
export function describeComputer(
  policy: AutomationComputerPolicy,
  bindings: ComputerBindingSource | undefined,
  authorized: boolean,
  trial: ComputerTrial | null,
): string {
  const label = (id: string) => bindings?.get(id)?.label ?? `${id} (not registered)`;
  const targets = policy.bindingIds.map((id) => {
    const binding = bindings?.get(id);
    if (!binding) return `- ${label(id)}`;
    if (binding.kind === 'browser')
      return `- "${binding.label}": its own browser profile, only on ${binding.allowedOrigins.join(', ')}, starting at ${binding.startUrl}`;
    return `- "${binding.label}": ${binding.appName} (${binding.bundleId}), the app at ${binding.appPath}`;
  });
  const steps = policy.recipe.steps.map((step, index) => {
    const effect = recipeStepEffect(step);
    const weight = isBusinessEffect(effect) ? `, a ${effect} with a real side effect` : '';
    const next = step.next.length ? `; then ${step.next.join(' or ')}` : '; ends here';
    return `${index + 1}. [${step.stepId}] ${step.label}: ${stepDetail(step)} on "${label(step.bindingId)}" (${effect}${weight})${next}`;
  });
  const standing = authorized
    ? 'Authorized: the existing grant covers this scope as it is.'
    : trial
      ? `A trial of exactly this scope passed at ${trial.at}; confirming also authorizes it to run unattended.`
      : 'No passed trial matches this scope, so it is saved without authorization and cannot act unattended until the person runs a trial and authorizes it in Settings.';
  return [
    'Computer use: each run acts on these targets in the background with nobody present, only through the steps below.',
    'Targets:',
    ...targets,
    'Steps:',
    ...steps,
    `At most ${policy.maxSubmits} submit action(s) per run; a business side effect is never retried automatically.`,
    `Done only when the host verifies: ${conditionText(policy.completion)}.`,
    standing,
  ].join('\n');
}
