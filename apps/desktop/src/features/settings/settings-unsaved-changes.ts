import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsSectionActiveContext, type SettingsPageControls } from './settings-navigation';

/**
 * The settings window's guard over editors with unsaved changes. An editor's edits live in its
 * component, so they end when a navigation unmounts it. Each editor is recorded at the depth of
 * the page that mounted it in its section's page history; pages opened deeper from an editor (the
 * command editor's parameter page) render inside it and keep it mounted.
 */
export interface SettingsUnsavedChangesGuard {
  /** Records an editor with unsaved changes mounted at `depth`; returns the removal. */
  register: (depth: number) => () => void;
  /** The depth of the page shown in the shown section's history (0 on its overview). */
  depth: () => number;
  /**
   * Runs `proceed` at once, or once the user chooses Discard, when leaving for `depth` unmounts an
   * editor with unsaved changes: one mounted deeper than `depth`. -1 leaves every page of the
   * section, as a section switch does. While one navigation waits for an answer, others are dropped.
   */
  confirmLeave: (depth: number, proceed: () => void) => void;
}

export const SettingsUnsavedChangesContext = createContext<SettingsUnsavedChangesGuard | null>(
  null,
);

/**
 * Reports an editor's unsaved changes to the settings window while its section is shown. While
 * `dirty` is true, leaving the editor asks first: the header's Back (⌘[), a section switch from
 * the navigation, a search result or a command link, and the page history's `back()` that the
 * editor's own Cancel calls.
 *
 * Saving is never asked about: after a successful save, leave through the page history's
 * `leave(from)` (or `replace`), which bypass the guard, not through `back()`. Clearing `dirty` in
 * the same event does not help, because the report updates only after the next render.
 */
export function useSettingsUnsavedChanges(dirty: boolean) {
  const guard = useContext(SettingsUnsavedChangesContext);
  const active = useContext(SettingsSectionActiveContext);
  // A passive effect reads the depth after the page history has registered the new page.
  const depth = useRef<number | null>(null);
  useEffect(() => {
    if (guard && depth.current === null) depth.current = guard.depth();
  }, [guard]);
  useEffect(() => {
    if (!guard || !dirty || !active) return;
    return guard.register(depth.current ?? guard.depth());
  }, [guard, dirty, active]);
}

/**
 * The window's side of the guard: the context value and the navigation waiting for the user's
 * answer. `pages` reads the shown section's page history outside rendering; keep it stable.
 */
export function useSettingsUnsavedChangesGuard(pages: () => SettingsPageControls | null) {
  const editors = useRef(new Map<number, number>());
  const nextId = useRef(0);
  const [pending, setPending] = useState<{ proceed: () => void } | null>(null);
  const guard = useMemo<SettingsUnsavedChangesGuard>(
    () => ({
      register: (at) => {
        const id = nextId.current++;
        editors.current.set(id, at);
        return () => editors.current.delete(id);
      },
      depth: () => pages()?.depth ?? 0,
      confirmLeave: (target, proceed) => {
        if ([...editors.current.values()].some((at) => at > target))
          setPending((current) => current ?? { proceed });
        else proceed();
      },
    }),
    [pages],
  );
  return {
    guard,
    open: pending !== null,
    keepEditing: () => setPending(null),
    discard: () => {
      setPending(null);
      pending?.proceed();
    },
  };
}
