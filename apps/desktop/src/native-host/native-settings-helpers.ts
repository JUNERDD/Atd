import {
  DEFAULT_COMMAND_TYPING,
  DEFAULT_COMMAND_TYPING_ANIMATION,
  DEFAULT_GLOW_EFFECTS,
  DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION,
  DEFAULT_NEXT_STEP_CLICK,
  DEFAULT_NEXT_STEPS,
  DEFAULT_PANEL_BACKGROUND,
  DEFAULT_RESULT_MARKDOWN,
  DEFAULT_SCREENSHOT_COPY_ON_CONFIRM,
  DEFAULT_SHORTCUTS,
  DEFAULT_SUMMARY_TITLES,
  DEFAULT_VIEW_INITIATIVE,
  type SettingsResponse,
} from '@atd/agent-contracts';
import { DEFAULT_PERMISSION_TIER } from '../client/agent/permission-schema';
import type { LiveProvidersSnapshot } from '../client/providers/live';
import type { ProviderBridge } from '../client/providers/schema';
import type { ProviderService } from '../client/providers/service';
import {
  DEFAULT_SELECTION_TOOLBAR,
  resolveLanguage,
  type SettingsSnapshot,
} from '../client/settings-contract';
import type { CallResult } from '../native-bridge/client';

/**
 * The preferences the shell owns (the panel's placement null until `app.state` answers), whether
 * it holds the panel, screenshot and record-screen shortcuts (null until the panel's first registration answer
 * reaches this window), whether macOS trusts the app for Accessibility and lets it capture the
 * screen (each null until the shell's `accessibility.trust` or `screenRecording.trust` arrives),
 * and whether the mini panel shows and how it opens (null until the shell's first
 * `miniPanel.state`).
 */
export type ShellState = Omit<CallResult<'app.state'>, 'panelPlacement'> & {
  panelPlacement: CallResult<'app.state'>['panelPlacement'] | null;
  shortcutAvailable: boolean | null;
  screenshotShortcutAvailable: boolean | null;
  recordShortcutAvailable: boolean | null;
  accessibilityTrusted: boolean | null;
  screenRecordingTrusted: boolean | null;
  miniPanelShown: boolean | null;
  miniPanelOpenOn: CallResult<'miniPanel.setOpenOn'>['openOn'] | null;
};

export function initialShellState(): ShellState {
  return {
    pinned: false,
    showInDock: false,
    openAtLogin: null,
    // Assumed until the shell answers, so no placement warning flashes at startup.
    widgetsAvailable: true,
    panelPlacement: null,
    shortcutAvailable: null,
    screenshotShortcutAvailable: null,
    recordShortcutAvailable: null,
    accessibilityTrusted: null,
    screenRecordingTrusted: null,
    miniPanelShown: null,
    miniPanelOpenOn: null,
  };
}

export function buildSettingsSnapshot(
  live: LiveProvidersSnapshot | null,
  statusesChecked: boolean,
  shared: SettingsResponse | null,
  shell: ShellState,
): SettingsSnapshot {
  const settings = shared?.settings;
  return {
    connections: live?.connections ?? [],
    defaultConnectionId: live?.defaultConnectionId ?? null,
    aliases: live?.aliases ?? [],
    defaultAliasId: live?.defaultAliasId ?? null,
    providersLoaded: live !== null,
    providerStatusesChecked: statusesChecked,
    language: settings?.language ?? resolveLanguage(navigator.language),
    appearance: settings?.appearance ?? null,
    glowEffects: settings?.glowEffects ?? DEFAULT_GLOW_EFFECTS,
    resultMarkdown: settings?.resultMarkdown ?? DEFAULT_RESULT_MARKDOWN,
    panelBackground: structuredClone(settings?.panelBackground ?? DEFAULT_PANEL_BACKGROUND),
    computerVisionModel: settings?.computerVisionModel ?? null,
    shortcuts: { ...(settings?.shortcuts ?? DEFAULT_SHORTCUTS) },
    ...shell,
    permissionTier: settings?.permissionTier ?? DEFAULT_PERMISSION_TIER,
    shellAllowlist: [...(settings?.shellAllowlist ?? [])],
    selectionToolbar: structuredClone(settings?.selectionToolbar ?? DEFAULT_SELECTION_TOOLBAR),
    screenshotCopyOnConfirm:
      settings?.screenshotCopyOnConfirm ?? DEFAULT_SCREENSHOT_COPY_ON_CONFIRM,
    longScreenshotConfirmAction:
      settings?.longScreenshotConfirmAction ?? DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION,
    commandTyping: settings?.commandTyping ?? DEFAULT_COMMAND_TYPING,
    commandTypingAnimation: settings?.commandTypingAnimation ?? DEFAULT_COMMAND_TYPING_ANIMATION,
    viewInitiative: settings?.viewInitiative ?? DEFAULT_VIEW_INITIATIVE,
    summaryTitles: settings?.summaryTitles ?? DEFAULT_SUMMARY_TITLES,
    nextSteps: settings?.nextSteps ?? DEFAULT_NEXT_STEPS,
    nextStepClick: settings?.nextStepClick ?? DEFAULT_NEXT_STEP_CLICK,
    onboardingCompleted: settings?.onboardingCompleted ?? false,
  };
}

export function buildProviderBridge(
  providers: ProviderService,
  loginListeners: Set<Parameters<ProviderBridge['onLogin']>[0]>,
): ProviderBridge {
  return {
    catalog: () => providers.catalog(),
    save: (draft) => providers.save(draft),
    setDefault: (id, revision) => providers.setDefault(id, revision),
    setModel: (reference, revision, level) => providers.setModel(reference, revision, level),
    levels: (reference) => providers.levels(reference),
    contexts: (reference) => providers.contexts(reference),
    setContext: (reference, choice, revision) => providers.setContext(reference, choice, revision),
    createAlias: (draft) => providers.createAlias(draft),
    updateAlias: (aliasId, draft) => providers.updateAlias(aliasId, draft),
    removeAlias: (aliasId) => providers.removeAlias(aliasId),
    setDefaultAlias: (defaultAliasId) => providers.setDefaultAlias(defaultAliasId),
    seedAliases: (aliases) => providers.seedAliases(aliases),
    disconnect: (id, revision) => providers.disconnect(id, revision),
    remove: (id, revision) => providers.remove(id, revision),
    refresh: (id) => providers.refresh(id),
    refreshCatalogs: async () => providers.refreshShownCatalogs(),
    checkStatuses: () => providers.checkStatuses(),
    verify: (reference) => providers.verify(reference),
    login: (id, request) => providers.login.start(id, request),
    answer: (id, promptId, value) => providers.login.answer(id, promptId, value),
    cancel: (id) => providers.login.cancel(id),
    openLink: (id) => providers.login.openLink(id),
    onLogin: (listener) => {
      loginListeners.add(listener);
      return () => loginListeners.delete(listener);
    },
  };
}
