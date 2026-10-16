import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { commandShortcut, DEFAULT_SHORTCUTS, type CommandShortcut } from '@atd/agent-contracts';
import type { CommandDefinition } from '../../client/agent/command-schema';
import {
  commandProblems,
  templateProblem,
  type CommandField,
  type CommandProblems,
} from '../../client/agent/command-validation';
import {
  shortcutProblems,
  type ShortcutContext,
  type ShortcutProblem,
} from '../../client/agent/shortcut-validation';
import { DEFAULT_SELECTION_TOOLBAR, type SettingsSnapshot } from '../../client/settings-contract';
import { useAgent } from '../agent/use-agent';
import { problemText, shortcutProblemText } from './command-problem';
import { useShortcutNames } from './shortcut-names';

/** What the editor checks a command's shortcuts against: the saved commands and app settings. */
export function useShortcutContext(settings: SettingsSnapshot | null): ShortcutContext {
  const commands = useAgent().snapshot?.commands ?? [];
  return {
    appShortcuts: settings?.shortcuts ?? DEFAULT_SHORTCUTS,
    commands,
    platform: window.desktop?.platform ?? 'web',
    selectionToolbar: settings?.selectionToolbar ?? DEFAULT_SELECTION_TOOLBAR,
  };
}

/**
 * The shell's registration error for one of `command`'s shortcuts, in the editor, or ''. A failed
 * registration belongs to the keys the shell registered, the saved shortcut's: it shows only while
 * the draft's shortcut still has them, never under keys recorded since.
 */
export function useRegistrationError(
  command: CommandDefinition,
): (shortcut: CommandShortcut) => string {
  const snapshot = useAgent().snapshot;
  const saved = snapshot?.commands.find((item) => item.id === command.id);
  return (shortcut) => {
    const registered = saved && commandShortcut(saved, shortcut.id);
    if (!registered || registered.accelerator !== shortcut.accelerator) return '';
    return snapshot?.shortcutErrors[shortcut.id] ?? '';
  };
}

/**
 * The command editor's field and shortcut errors. Save checks every field and shortcut;
 * afterwards a field that shows a problem is checked again when focus leaves it, so an error never
 * appears while the user is still typing. Template problems in non-empty instructions show as
 * they are typed, since the editor marks the offending variables at the same time. A shortcut's
 * problem shows on its row (`shortcutErrorId`).
 */
export function useCommandProblems(draft: CommandDefinition, settings: SettingsSnapshot | null) {
  const { t } = useTranslation('commands');
  const { t: tSettings } = useTranslation('settings');
  const names = useShortcutNames();
  const context = useShortcutContext(settings);
  const [problems, setProblems] = useState<CommandProblems>({});
  const [shortcuts, setShortcuts] = useState<Record<string, ShortcutProblem>>({});
  /** Checks every field and shortcut; returns whether the draft can be saved. */
  function check(): boolean {
    const found = commandProblems(draft);
    const held = shortcutProblems(draft, context);
    setProblems(found);
    setShortcuts(held);
    const field = Object.values(found)[0]?.field;
    const shortcut = Object.keys(held)[0];
    const first = field ? errorId(field) : shortcut ? shortcutErrorId(shortcut) : null;
    if (first)
      requestAnimationFrame(() =>
        document.getElementById(first)?.scrollIntoView({ block: 'nearest' }),
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
  /**
   * Checks the shortcuts of `command` again: the ones showing a problem, or with `reveal` every
   * one, as after a parameter change that may have invalidated a pinned value.
   */
  function recheckShortcuts(command: CommandDefinition = draft, reveal = false) {
    const found = shortcutProblems(command, context);
    if (reveal) {
      setShortcuts(found);
      return;
    }
    setShortcuts(
      Object.fromEntries(Object.entries(found).filter(([id]) => shortcuts[id] !== undefined)),
    );
  }
  /** The field's error in the app's language, or '' when it has none. */
  function text(field: CommandField): string {
    const problem =
      field === 'instructions' && draft.instructions.trim()
        ? templateProblem(draft)
        : problems[field];
    return problem ? problemText(problem, t) : '';
  }
  /** The shortcut's error in the app's language, or '' when it has none. */
  function shortcutText(id: string): string {
    const problem = shortcuts[id];
    return problem
      ? shortcutProblemText(problem, {
          t,
          tSettings,
          names,
          command: draft,
          commands: context.commands,
        })
      : '';
  }
  return { check, recheck, recheckShortcuts, text, shortcutText, context };
}

/** The id of the element that shows `field`'s error, for the field's `aria-describedby`. */
export function errorId(field: CommandField): string {
  return `command-${field}-error`;
}

/** The id of the element that shows a shortcut's error, on its row. */
export function shortcutErrorId(shortcutId: string): string {
  return `command-shortcut-${shortcutId}-error`;
}
