import { useCallback, useEffect, useState } from 'react';
import { isCommandId } from '../commands/open-command-settings';
import { findSettingsSection, type SettingsSectionId } from './settings-sections';

/** Where the window remembers the section shown last, for the next time it opens. */
const LAST_SECTION_KEY = 'settings.lastSection';

/** A new settings window carries its editor target in the URL hash. */
function readCommandIdFromHash(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#settings?')) return null;
  const commandId = new URLSearchParams(hash.slice('#settings?'.length)).get('commandId');
  return isCommandId(commandId) ? commandId : null;
}

/** Storage can be unavailable or cleared; the window then opens at its first section. */
function readLastSection(): SettingsSectionId | null {
  try {
    const stored = window.localStorage.getItem(LAST_SECTION_KEY);
    return stored ? (findSettingsSection(stored)?.id ?? null) : null;
  } catch {
    return null;
  }
}

function storeLastSection(section: SettingsSectionId) {
  try {
    window.localStorage.setItem(LAST_SECTION_KEY, section);
  } catch {
    // Remembering the section is a convenience; the window still opens without it.
  }
}

/** How the drawer is shown: closed, or open with focus on the section list or on the search. */
export type SettingsDrawerState = 'section' | 'search' | null;

/**
 * The shown settings section and the ways into it. The window opens at a command link's editor,
 * else at the section shown last. `leave` asks before a switch discards unsaved edits (see
 * `useSettingsUnsavedChanges`); while `locked` (a shortcut is being recorded) nothing switches.
 */
export function useSettingsSection(
  locked: boolean,
  leave: (depth: number, proceed: () => void) => void,
) {
  // Only the shown section: each section keeps its own page history (`useSettingsPageHistory`).
  const [section, setSection] = useState<SettingsSectionId>(() =>
    readCommandIdFromHash() ? 'commands' : (readLastSection() ?? 'permissions'),
  );
  const [visited, setVisited] = useState<readonly SettingsSectionId[]>([section]);
  const [commandTarget, setCommandTarget] = useState<{ id: string; nonce: number } | null>(() => {
    const id = readCommandIdFromHash();
    return id ? { id, nonce: 0 } : null;
  });
  const [drawer, setDrawer] = useState<SettingsDrawerState>(null);
  // Every way into a section (the list, search, a link) mounts it on its first visit.
  if (!visited.includes(section)) setVisited([...visited, section]);
  useEffect(() => storeLastSection(section), [section]);

  /** Shows a section, then runs `then`; staying on the shown section never asks. */
  const navigate = useCallback(
    (next: string, then?: () => void) => {
      const target = findSettingsSection(next);
      if (locked || !target) return;
      const show = () => {
        setSection(target.id);
        setDrawer(null);
        then?.();
      };
      if (target.id === section) show();
      else leave(-1, show);
    },
    [locked, section, leave],
  );
  /**
   * Shows one command's editor; the task panel and plugin pages link to commands this way. Each
   * request has a new nonce, which the Commands section opens as a page of its history, so it
   * always leaves the page shown.
   */
  const showCommand = useCallback(
    (commandId: unknown) => {
      if (locked || !isCommandId(commandId)) return;
      leave(-1, () => {
        setSection('commands');
        setDrawer(null);
        setCommandTarget((current) => ({ id: commandId, nonce: (current?.nonce ?? 0) + 1 }));
      });
    },
    [locked, leave],
  );
  // The task panel can request the editor for one command while this window is already open.
  useEffect(
    () => window.desktop?.settings.onOpenCommand?.((commandId) => showCommand(commandId)),
    [showCommand],
  );
  return { section, visited, commandTarget, drawer, setDrawer, navigate, showCommand };
}
