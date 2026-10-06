import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { AutomationDraft } from '@atd/agent-contracts';
import type { CommandDefinition } from '../../client/agent/command-schema';
import {
  AUTOMATION_FIELDS,
  draftProblems,
  type AutomationField,
  type AutomationProblem,
  type AutomationProblems,
} from './automation-problems';

/** A problem in the app's language. */
export function problemText(problem: AutomationProblem, t: TFunction<'automations'>): string {
  return problem.code === 'argumentsInvalid'
    ? t('validation.argumentsInvalid', { labels: problem.labels })
    : t(`validation.${problem.code}`);
}

/** The id of the element that shows `field`'s problem, for the field's `aria-describedby`. */
export function errorId(field: AutomationField): string {
  return `automation-${field}-error`;
}

/**
 * The automation editor's field problems, worded in the app's language. Save checks every field;
 * afterwards a change checks again only the fields that already show a problem, so a fixed field
 * clears at once while a new problem never appears before the next save.
 */
export function useAutomationProblems(
  draft: AutomationDraft,
  commands: readonly CommandDefinition[],
  folderName: (folderId: string) => string | undefined,
) {
  const { t } = useTranslation('automations');
  const [problems, setProblems] = useState<AutomationProblems>({});
  /** Checks every field; returns whether the draft can be saved. */
  function check(): boolean {
    const found = draftProblems(draft, commands, folderName);
    setProblems(found);
    const first = AUTOMATION_FIELDS.find((field) => found[field]);
    if (first)
      requestAnimationFrame(() =>
        document.getElementById(errorId(first))?.scrollIntoView({ block: 'nearest' }),
      );
    return !first;
  }
  /** Checks `next` again for the fields that show a problem; call it after each change. */
  function recheck(next: AutomationDraft) {
    if (!AUTOMATION_FIELDS.some((field) => problems[field])) return;
    const found = draftProblems(next, commands, folderName);
    const kept: AutomationProblems = {};
    for (const field of AUTOMATION_FIELDS) {
      const problem = found[field];
      if (problems[field] && problem) kept[field] = problem;
    }
    setProblems(kept);
  }
  /** The field's problem in the app's language, or '' when it has none. */
  function text(field: AutomationField): string {
    const problem = problems[field];
    return problem ? problemText(problem, t) : '';
  }
  return { check, recheck, text };
}

/** The editor's field problems, as the field sections read them. */
export type AutomationProblemsView = ReturnType<typeof useAutomationProblems>;
