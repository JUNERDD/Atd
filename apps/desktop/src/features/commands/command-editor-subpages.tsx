import type { Dispatch, SetStateAction } from 'react';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { renameArgument } from '../../client/agent/command-validation';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { EditorSubpages, ShownSubpage } from './command-routes';
import { ParameterEditor } from './parameter-editor';
import { withRenamedPin } from './shortcut-drafts';
import { ShortcutEditor } from './shortcut-editor';
import type { useCommandProblems } from './use-command-problems';

/**
 * The page shown over the command editor: a parameter's or a shortcut's. Each edits a copy and
 * hands it back to the editor's draft, which follows the change where it reaches further: a
 * renamed parameter renames its variables in the instructions and its pinned values, and every
 * shortcut is checked again, since a parameter change may have invalidated a pinned value.
 */
export function EditorSubpage({
  shown,
  draft,
  setDraft,
  problems,
  subpages,
  settings,
}: {
  shown: ShownSubpage;
  draft: CommandDefinition;
  setDraft: Dispatch<SetStateAction<CommandDefinition>>;
  problems: ReturnType<typeof useCommandProblems>;
  subpages: EditorSubpages;
  settings: SettingsSnapshot | null;
}) {
  function apply(next: CommandDefinition) {
    setDraft(next);
    problems.recheck('parameters', next);
    problems.recheckShortcuts(next, shown.page === 'parameter');
  }
  if (shown.page === 'parameter') {
    const { index } = shown;
    return (
      <ParameterEditor
        initial={index === null ? null : draft.parameters[index]!}
        commandName={draft.name}
        keys={draft.parameters.filter((_, i) => i !== index).map((item) => item.key)}
        onCancel={() => subpages.close()}
        onSave={(value) => {
          const parameters = [...draft.parameters];
          const previousKey = index === null ? null : parameters[index]!.key;
          if (index === null) parameters.push(value);
          else parameters[index] = value;
          const renamed = previousKey !== null && previousKey !== value.key;
          apply({
            ...draft,
            parameters,
            instructions: renamed
              ? renameArgument(draft.instructions, previousKey, value.key)
              : draft.instructions,
            shortcuts: renamed
              ? withRenamedPin(draft.shortcuts, previousKey, value.key)
              : draft.shortcuts,
          });
          subpages.close({ page: 'parameter', key: value.key });
        }}
      />
    );
  }
  const initial = shown.shortcut;
  return (
    <ShortcutEditor
      initial={initial}
      command={draft}
      settings={settings}
      onCancel={() => subpages.close()}
      onDone={(shortcut) => {
        apply({
          ...draft,
          shortcuts: initial
            ? draft.shortcuts.map((item) => (item.id === shortcut.id ? shortcut : item))
            : [...draft.shortcuts, shortcut],
        });
        subpages.close({ page: 'shortcut', id: shortcut.id });
      }}
      // The page leaves once the draft no longer has its shortcut (`useShownSubpage`).
      onDelete={() =>
        apply({ ...draft, shortcuts: draft.shortcuts.filter((item) => item !== initial) })
      }
    />
  );
}
