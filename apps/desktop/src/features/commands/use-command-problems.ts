import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandDefinition } from '../../client/agent/command-schema';
import {
  commandProblems,
  templateProblem,
  type CommandField,
  type CommandProblems,
} from '../../client/agent/command-validation';
import { problemText } from './command-problem';

/**
 * The command editor's field errors. Save checks every field; afterwards a field that shows a
 * problem is checked again when focus leaves it, so an error never appears while the user is
 * still typing. Template problems in non-empty instructions show as they are typed, since the
 * editor marks the offending variables at the same time.
 */
export function useCommandProblems(draft: CommandDefinition) {
  const { t } = useTranslation('commands');
  const [problems, setProblems] = useState<CommandProblems>({});
  /** Checks every field; returns whether the draft can be saved. */
  function check(): boolean {
    const found = commandProblems(draft);
    setProblems(found);
    const first = Object.values(found)[0]?.field;
    if (first)
      requestAnimationFrame(() =>
        document.getElementById(errorId(first))?.scrollIntoView({ block: 'nearest' }),
      );
    return !first;
  }
  /** Checks `field` of `command` again if it already shows a problem. */
  function recheck(field: CommandField, command: CommandDefinition = draft) {
    if (!problems[field]) return;
    const next = { ...problems };
    const problem = commandProblems(command)[field];
    if (problem) next[field] = problem;
    else delete next[field];
    setProblems(next);
  }
  /** The field's error in the app's language, or '' when it has none. */
  function text(field: CommandField): string {
    const problem =
      field === 'instructions' && draft.instructions.trim()
        ? templateProblem(draft)
        : problems[field];
    return problem ? problemText(problem, t) : '';
  }
  return { check, recheck, text };
}

/** The id of the element that shows `field`'s error, for the field's `aria-describedby`. */
export function errorId(field: CommandField): string {
  return `command-${field}-error`;
}
