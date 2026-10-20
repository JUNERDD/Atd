import type { TFunction } from 'i18next';
import {
  recipeStepEffect,
  type AutomationComputerPolicy,
  type AutomationItem,
  type ComputerCondition,
  type ComputerLocator,
  type ComputerRecipeStep,
  type ComputerSemanticLocator,
} from '@atd/agent-contracts';

/**
 * The computer scope of an automation as the editor reads and changes it: the recipe's steps and
 * completion condition in words, the parameters a person may tighten, and where its authorization
 * stands. The recipe itself is written where Atd did the work with the person (the automation
 * tool); the editor never adds, removes or reorders steps.
 */

type Translate = TFunction<'automations'>;

/** A step's control as people read it: its label or name, else its placeholder or text. */
export function locatorWords(locator: ComputerSemanticLocator | undefined): string {
  if (!locator) return '';
  return locator.label ?? locator.name ?? locator.placeholder ?? locator.text ?? locator.role ?? '';
}

/** A condition's control: a semantic one by its words; a runtime ref has none to show. */
function controlWords(locator: ComputerLocator, t: Translate): string {
  return 'ref' in locator ? t('computer.condition.someControl') : locatorWords(locator);
}

/** A condition in words; runtime values (text, URLs, patterns) stay as written. */
export function conditionWords(condition: ComputerCondition, t: Translate): string {
  switch (condition.kind) {
    case 'menuItemAvailable':
      return t('computer.condition.menuItemAvailable', { path: condition.path.join(' > ') });
    case 'enabled':
      return t('computer.condition.enabled', { control: controlWords(condition.locator, t) });
    case 'valueEquals':
      return t('computer.condition.valueEquals', {
        control: controlWords(condition.locator, t),
        text: condition.text,
      });
    case 'textAppears':
      return t('computer.condition.textAppears', { text: condition.text });
    case 'urlMatches':
      return t('computer.condition.urlMatches', { url: condition.pattern });
    case 'newText':
      return condition.pattern
        ? t('computer.condition.newTextMatching', { pattern: condition.pattern })
        : t('computer.condition.newText');
  }
}

/** What a step does, in words: its kind with the control it acts on. */
export function stepWords(step: ComputerRecipeStep, t: Translate): string {
  switch (step.kind) {
    case 'navigate':
      return t('computer.stepKind.navigate', { url: step.urlPrefix });
    case 'fill':
    case 'setValue':
      return t('computer.stepKind.fill', { control: locatorWords(step.locator) });
    case 'press':
      return step.effect === 'submit'
        ? t('computer.stepKind.submit', { control: locatorWords(step.locator) })
        : t('computer.stepKind.click', { control: locatorWords(step.locator) });
    case 'scroll':
      return t('computer.stepKind.scroll');
    case 'wait':
      return t('computer.stepKind.wait', { condition: conditionWords(step.condition, t) });
  }
}

/** Whether a step submits: a recipe's one business side effect, which the scope counts. */
export function isSubmitStep(step: ComputerRecipeStep): boolean {
  return recipeStepEffect(step) === 'submit';
}

/** The scope with exactly `bindingIds` as its targets, in the order given. */
export function withTargets(
  scope: AutomationComputerPolicy,
  bindingIds: readonly string[],
): AutomationComputerPolicy {
  return { ...scope, bindingIds: [...bindingIds] };
}

/** The scope with step `stepId`'s longest text set to `maxLength`. */
export function withMaxLength(
  scope: AutomationComputerPolicy,
  stepId: string,
  maxLength: number,
): AutomationComputerPolicy {
  return {
    ...scope,
    recipe: {
      ...scope.recipe,
      steps: scope.recipe.steps.map((step) =>
        step.stepId === stepId && (step.kind === 'fill' || step.kind === 'setValue')
          ? { ...step, text: { ...step.text, maxLength } }
          : step,
      ),
    },
  };
}

/**
 * Where the saved automation's authorization stands: `authorized` while its grant matches,
 * `changed` when the service says the grant no longer matches what is saved (an edit, a target
 * that changed, a newer command), `needed` when it never had one or it was revoked.
 */
export function authorizationState(
  item: AutomationItem | null,
): 'authorized' | 'changed' | 'needed' {
  const grant = item?.automation.computerGrant;
  if (!grant || grant.revokedAt) return 'needed';
  return item.status.problem === 'computerNeedsAuthorization' ? 'changed' : 'authorized';
}
