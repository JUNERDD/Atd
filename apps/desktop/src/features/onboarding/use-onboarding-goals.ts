import { useEffect, useRef, useState } from 'react';
import { findModelAlias } from '@atd/agent-contracts';
import type { OnboardingBridge } from '../../client/contract';
import type { Connection } from '../../client/providers/schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { OnboardingGoals } from './onboarding-types';

function isUsableConnection(connection: Connection | undefined): connection is Connection {
  return Boolean(connection?.connected && connection.credentialIssue == null);
}

function resolveModelName(connection: Connection, modelId: string): string {
  const model = [...connection.catalog, ...connection.customModels].find(
    (item) => item.id === modelId,
  );
  return model?.name ?? modelId;
}

export interface ReadyConnection {
  connection: Connection;
  model: string;
  aliasName?: string;
}

/**
 * The active default target when it can run tasks: first the default model alias (if its
 * connection is connected and its credential is readable), else the default connection with a
 * default model. Its model shows by name when the catalog knows it.
 */
export function readyConnection(snapshot: SettingsSnapshot | null): ReadyConnection | null {
  if (!snapshot) return null;
  const alias = findModelAlias(snapshot.aliases, snapshot.defaultAliasId ?? undefined);
  if (alias) {
    const connection = snapshot.connections.find(
      (item) => item.connectionId === alias.connectionId,
    );
    if (isUsableConnection(connection)) {
      return {
        connection,
        model: resolveModelName(connection, alias.modelId),
        aliasName: alias.name,
      };
    }
  }
  const connection = snapshot.connections.find(
    (item) => item.connectionId === snapshot.defaultConnectionId,
  );
  if (!isUsableConnection(connection) || !connection.defaultModel) return null;
  return {
    connection,
    model: resolveModelName(connection, connection.defaultModel),
  };
}

/**
 * The saved connection whose OS credentials could not be read, prioritizing the default alias's
 * connection, then the default connection, then any remaining unreadable connection.
 */
export function unreadableConnection(snapshot: SettingsSnapshot | null): Connection | null {
  if (!snapshot) return null;
  const alias = findModelAlias(snapshot.aliases, snapshot.defaultAliasId ?? undefined);
  if (alias) {
    const aliasConnection = snapshot.connections.find(
      (item) => item.connectionId === alias.connectionId,
    );
    if (aliasConnection?.credentialIssue === 'unreadable') return aliasConnection;
  }
  const defaultConnection = snapshot.connections.find(
    (item) => item.connectionId === snapshot.defaultConnectionId,
  );
  if (defaultConnection?.credentialIssue === 'unreadable') return defaultConnection;
  return snapshot.connections.find((item) => item.credentialIssue === 'unreadable') ?? null;
}

/**
 * Whether the user's panel was shown while the guide is open. The shell reports every show and
 * hide; the first show proves the global shortcut works (any summon counts), and it stays proven
 * for the session.
 */
function usePanelShown(onboarding: OnboardingBridge | undefined) {
  const [shown, setShown] = useState(false);
  useEffect(
    () =>
      onboarding?.onPanelVisibility((visible) => {
        if (visible) setShown(true);
      }),
    [onboarding],
  );
  return shown;
}

/**
 * Each goal step's goal, read from the app's real state only (`OnboardingGoals`): the panel shown
 * since the guide opened (hotkey), the system's Accessibility grant (selection), the Screen
 * Recording grant this running app holds (screenshot), a ready default alias or connection
 * (provider).
 */
export function useOnboardingGoals(
  snapshot: SettingsSnapshot | null,
  onboarding: OnboardingBridge | undefined,
  hotkeyTested = false,
): OnboardingGoals {
  const hotkey = usePanelShown(onboarding);
  const probedRef = useRef(false);
  const providersLoaded = snapshot?.providersLoaded === true;
  const providerStatusesChecked = snapshot?.providerStatusesChecked === true;

  useEffect(() => {
    if (!providersLoaded || providerStatusesChecked) {
      probedRef.current = false;
      return;
    }
    if (probedRef.current) return;
    probedRef.current = true;
    void window.desktop?.settings.providers.checkStatuses().catch(() => undefined);
  }, [providersLoaded, providerStatusesChecked]);

  return {
    hotkey: hotkey || hotkeyTested,
    selection: snapshot?.accessibilityTrusted === true,
    screenshot: snapshot?.screenRecordingTrusted === true,
    provider: readyConnection(snapshot) !== null,
  };
}
