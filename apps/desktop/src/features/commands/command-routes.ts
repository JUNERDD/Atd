import { useEffect } from 'react';
import { commandShortcut, type CommandShortcut } from '@atd/agent-contracts';
import type { CommandDefinition } from '../../client/agent/command-schema';
import type { useSettingsPageHistory } from '../settings/use-settings-page-history';

/**
 * An editor page of the Commands section: a saved command's (read-only for a plugin's), where
 * `nonce` tells repeated deep links apart and `section` names the group to scroll to as it opens,
 * or a new or duplicated command's until it is saved.
 */
export type EditorRoute =
  | { page: 'command'; id: string; nonce?: number; section?: 'shortcuts' }
  | { page: 'draft'; command: CommandDefinition };

/** A page over the command editor: a parameter's or a shortcut's, by key or id (null: new). */
export type SubpageRoute =
  | { page: 'parameter'; key: string | null }
  | { page: 'shortcut'; id: string | null };

/** A page of the Commands section: the list, an editor, or a page over its editor. */
export type CommandRoute =
  | { page: 'list' }
  | EditorRoute
  | (SubpageRoute & { editor: EditorRoute });

export const LIST: CommandRoute = { page: 'list' };

export function editorOf(route: CommandRoute): EditorRoute | null {
  if (route.page === 'list') return null;
  return 'editor' in route ? route.editor : route;
}

/**
 * The pages over the command editor, pages of the Commands section's history: header Back and
 * Forward step through them and the breadcrumb names them, like the editor itself.
 */
export interface EditorSubpages {
  /** The page shown over the editor; null shows the editor. */
  shown: SubpageRoute | null;
  open: (page: SubpageRoute) => void;
  /** Leaves the page; after a save, `saved` is the page Forward then reopens. */
  close: (saved?: SubpageRoute) => void;
  /** Leaves a page whose parameter or shortcut the draft no longer has, as after a deletion. */
  discard: () => void;
}

/** The editor's sub-pages in `history`, for the editor that `editor` opened. */
export function editorSubpages(
  history: ReturnType<typeof useSettingsPageHistory<CommandRoute>>,
  editor: EditorRoute,
): EditorSubpages {
  const { route, open, back, replace, leave, discard } = history;
  const shown: SubpageRoute | null =
    route.page === 'parameter'
      ? { page: 'parameter', key: route.key }
      : route.page === 'shortcut'
        ? { page: 'shortcut', id: route.id }
        : null;
  return {
    shown,
    open: (page) => open({ ...page, editor }),
    close: (saved) => {
      // A saved page leaves without the unsaved-changes question; Cancel asks.
      if (saved === undefined) return back();
      const page: CommandRoute = { ...saved, editor };
      replace(page);
      leave(page);
    },
    discard,
  };
}

/** What a sub-page edits in the draft: a parameter by index or a shortcut (null: a new one). */
export type ShownSubpage =
  | { page: 'parameter'; index: number | null }
  | { page: 'shortcut'; shortcut: CommandShortcut | null };

/**
 * The draft's item the shown sub-page edits, or null while the editor shows. A page whose
 * parameter or shortcut the draft no longer has (Back discarded the draft, the shortcut was
 * deleted) leaves the history at once, and the editor shows meanwhile.
 */
export function useShownSubpage(
  draft: CommandDefinition,
  subpages: EditorSubpages,
): ShownSubpage | null {
  const { shown, discard } = subpages;
  let target: ShownSubpage | null = null;
  if (shown?.page === 'parameter') {
    const index =
      shown.key === null ? null : draft.parameters.findIndex((item) => item.key === shown.key);
    if (index !== -1) target = { page: 'parameter', index };
  } else if (shown?.page === 'shortcut') {
    const shortcut = shown.id === null ? null : commandShortcut(draft, shown.id);
    if (shortcut !== undefined) target = { page: 'shortcut', shortcut };
  }
  const missing = Boolean(shown) && !target;
  useEffect(() => {
    if (missing) discard();
  }, [missing, discard]);
  return target;
}
