import { useState } from 'react';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { showErrorToast } from '../../components/toast-store';
import { agentApi } from '../agent/use-agent';

/**
 * The order of the user's own commands as the list shows it; plugin commands keep theirs. A drag
 * reorders locally and commits once on drop, so the service sees one write per move; a keyboard
 * move commits at once. A new list from the service always wins over the local order, and a
 * refused commit (the list changed meanwhile) falls back to the service's order with a toast.
 */
export function useCommandOrder(commands: readonly CommandDefinition[]) {
  const saved = commands.flatMap((command) => (command.pluginId ? [] : [command.id]));
  // Compared by content: every snapshot hands over a new array, and resetting on those would
  // drop the dragged order mid-drag.
  const signature = saved.join('\n');
  const [seen, setSeen] = useState(signature);
  const [order, setOrder] = useState<string[] | null>(null);
  if (seen !== signature) {
    setSeen(signature);
    setOrder(null);
  }
  const shown = order ?? saved;

  async function commit(next: readonly string[]) {
    if (next.join('\n') === signature) {
      setOrder(null);
      return;
    }
    try {
      await agentApi().reorderCommands([...next]);
    } catch (error) {
      setOrder(null);
      showErrorToast(error);
    }
  }

  return {
    /** The user's command ids in the order to show them. */
    shown,
    /** A drag's intermediate order, shown until it is committed on drop. */
    reorder: setOrder,
    commit: () => void commit(shown),
    /** Moves one command a place up or down and saves the result. */
    move(id: string, offset: -1 | 1) {
      const from = shown.indexOf(id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= shown.length) return;
      const next = shown.filter((item) => item !== id);
      next.splice(to, 0, id);
      setOrder(next);
      void commit(next);
    },
  };
}
