import { useCallback, useEffect, useState } from 'react';
import { isCommandId } from '../commands/open-command-settings';
import { USER_PLUGIN_ID } from '../service/plugin-rows';
import type { SettingsAutomationTarget, SettingsExtensionItem } from './settings-navigation';
import { findSettingsSection, settingsSections, type SettingsSectionId } from './settings-sections';

/** A new settings window carries its editor or section target in the URL hash. */
function readHashParam(name: 'commandId' | 'section'): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#settings?')) return null;
  return new URLSearchParams(hash.slice('#settings?'.length)).get(name);
}

function readCommandIdFromHash(): string | null {
  const commandId = readHashParam('commandId');
  return isCommandId(commandId) ? commandId : null;
}

function readSectionFromHash(): SettingsSectionId | null {
  const section = readHashParam('section');
  return section ? (findSettingsSection(section)?.id ?? null) : null;
}

/** How the drawer is shown: closed, or open with focus on the section list or on the search. */
export type SettingsDrawerState = 'section' | 'search' | null;

/**
 * The shown settings section and the ways into it. The window opens at a command link's editor,
 * else at a section link's section, else at the first section. `leave` asks before a switch
 * discards unsaved edits (see `useSettingsUnsavedChanges`); while `locked` (a shortcut is being
 * recorded) nothing switches.
 */
export function useSettingsSection(
  locked: boolean,
  leave: (depth: number, proceed: () => void) => void,
) {
  // Only the shown section: each section keeps its own page history (`useSettingsPageHistory`).
  const [section, setSection] = useState<SettingsSectionId>(() =>
    readCommandIdFromHash() ? 'commands' : (readSectionFromHash() ?? settingsSections[0].id),
  );
  const [visited, setVisited] = useState<readonly SettingsSectionId[]>([section]);
  const [commandTarget, setCommandTarget] = useState<{ id: string; nonce: number } | null>(() => {
    const id = readCommandIdFromHash();
    return id ? { id, nonce: 0 } : null;
  });
  const [memoryTarget, setMemoryTarget] = useState<{ id: string; nonce: number } | null>(null);
  const [automationTarget, setAutomationTarget] = useState<
    (SettingsAutomationTarget & { nonce: number }) | null
  >(null);
  const [extensionTarget, setExtensionTarget] = useState<
    (SettingsExtensionItem & { nonce: number }) | null
  >(null);
  const [drawer, setDrawer] = useState<SettingsDrawerState>(null);
  // Every way into a section (the list, search, a link) mounts it on its first visit.
  if (!visited.includes(section)) setVisited([...visited, section]);

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
  /** Shows one memory's editor, as `showCommand` does for a command. */
  const showMemory = useCallback(
    (entryId: string) => {
      if (locked) return;
      leave(-1, () => {
        setSection('memory');
        setDrawer(null);
        setMemoryTarget((current) => ({ id: entryId, nonce: (current?.nonce ?? 0) + 1 }));
      });
    },
    [locked, leave],
  );
  /**
   * Shows an automation's editor: a new one that runs one command ("Automate…" on a command's
   * row), or a saved one (a turn's artifact card).
   */
  const showAutomation = useCallback(
    (target: SettingsAutomationTarget) => {
      if (locked) return;
      leave(-1, () => {
        setSection('automations');
        setDrawer(null);
        setAutomationTarget((current) => ({ ...target, nonce: (current?.nonce ?? 0) + 1 }));
      });
    },
    [locked, leave],
  );
  /** Shows one Extensions item's page, as `showCommand` does for a command. */
  const showExtension = useCallback(
    (item: SettingsExtensionItem) => {
      if (locked) return;
      leave(-1, () => {
        setSection('extensions');
        setDrawer(null);
        setExtensionTarget((current) => ({ ...item, nonce: (current?.nonce ?? 0) + 1 }));
      });
    },
    [locked, leave],
  );
  // The task panel can request the editor for one command while this window is already open.
  useEffect(
    () => window.desktop?.settings.onOpenCommand?.((commandId) => showCommand(commandId)),
    [showCommand],
  );
  // The welcome guide asks an open window for one section (Providers).
  useEffect(
    () => window.desktop?.settings.onOpenSection?.((target) => navigate(target)),
    [navigate],
  );
  // A turn's artifact card in the task panel asks for one saved item's page.
  useEffect(
    () =>
      window.desktop?.settings.onOpenItem?.((item) => {
        if (item.section === 'memory') showMemory(item.id);
        else if (item.section === 'automations') showAutomation({ automationId: item.id });
        else showExtension({ pluginId: USER_PLUGIN_ID, kind: item.kind, name: item.name });
      }),
    [showMemory, showAutomation, showExtension],
  );
  return {
    section,
    visited,
    commandTarget,
    memoryTarget,
    automationTarget,
    extensionTarget,
    drawer,
    setDrawer,
    navigate,
    showCommand,
    showMemory,
    showAutomation,
    showExtension,
  };
}
