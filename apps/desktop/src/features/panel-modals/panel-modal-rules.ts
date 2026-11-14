import type { ReactNode } from 'react';
import { Type, type Static } from 'typebox';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { PanelView } from '../agent/use-task-panel';

export const PANEL_MODAL_STORAGE_PREFIX = 'atd.panelModal:';

export const PanelModalStateSchema = Type.Object({
  impressions: Type.Number({ minimum: 0 }),
  lastShownAt: Type.Union([Type.Number(), Type.Null()]),
  dismissedRevision: Type.Union([Type.Number(), Type.Null()]),
  completedRevision: Type.Union([Type.Number(), Type.Null()]),
});

export type PanelModalState = Static<typeof PanelModalStateSchema>;

export const EMPTY_PANEL_MODAL_STATE: PanelModalState = {
  impressions: 0,
  lastShownAt: null,
  dismissedRevision: null,
  completedRevision: null,
};

export function isPanelModalStateEmpty(state: PanelModalState): boolean {
  return (
    state.impressions === 0 &&
    state.lastShownAt === null &&
    state.dismissedRevision === null &&
    state.completedRevision === null
  );
}

export function restorePanelModalState(state: PanelModalState): PanelModalState {
  return {
    impressions:
      Number.isFinite(state.impressions) && state.impressions >= 0 ? state.impressions : 0,
    lastShownAt:
      state.lastShownAt !== null && Number.isFinite(state.lastShownAt) ? state.lastShownAt : null,
    dismissedRevision:
      state.dismissedRevision !== null && Number.isFinite(state.dismissedRevision)
        ? state.dismissedRevision
        : null,
    completedRevision:
      state.completedRevision !== null && Number.isFinite(state.completedRevision)
        ? state.completedRevision
        : null,
  };
}

export type MacPermissionKind = 'accessibility' | 'screenRecording';

export interface PanelModalEnvironment {
  platform: string;
  hasDesktopBridge: boolean;
  windowVisible: boolean;
  now: number;
}

export interface PanelModalContext {
  snapshot: SettingsSnapshot;
  view: PanelView;
  state: PanelModalState;
  revision: number;
  env: PanelModalEnvironment;
}

export type PanelModalRule = (ctx: PanelModalContext) => boolean;

export interface PanelModalRenderProps {
  active: boolean;
  snapshot: SettingsSnapshot;
  onDismiss: () => void;
  onComplete: () => void;
}

export interface PanelModalDefinition {
  id: string;
  /** Incrementing revision re-enables a modal for future rollouts without changing IDs. */
  revision: number;
  /** Higher priority appears earlier when multiple eligible modals open together. */
  priority: number;
  /** True when the slide renders a dark media stage at the top for outer close-button styling. */
  hasMedia?: boolean;
  /** Whether the generic macOS menu item includes this modal when reopened (defaults to true). */
  reopenable?: boolean | PanelModalRule;
  rule: PanelModalRule;
  /** True while actionable issues remain when startup probes separate unknown from healthy. */
  unresolved?: PanelModalRule;
  /** When true while open after unresolved state, the host completes and closes or advances it. */
  resolved?: PanelModalRule;
  render: (props: PanelModalRenderProps) => ReactNode;
}

export function allRules(...rules: PanelModalRule[]): PanelModalRule {
  return (ctx) => rules.every((rule) => rule(ctx));
}

export function anyRule(...rules: PanelModalRule[]): PanelModalRule {
  return (ctx) => rules.some((rule) => rule(ctx));
}

export function notRule(rule: PanelModalRule): PanelModalRule {
  return (ctx) => !rule(ctx);
}

export function oncePerRevision(): PanelModalRule {
  return ({ state, revision }) =>
    state.completedRevision !== revision && state.dismissedRevision !== revision;
}

export function notDismissedInRevision(): PanelModalRule {
  return ({ state, revision }) => state.dismissedRevision !== revision;
}

export function untilCompleted(): PanelModalRule {
  return ({ state, revision }) => state.completedRevision !== revision;
}

export function maxImpressions(max: number): PanelModalRule {
  return ({ state }) => state.impressions < max;
}

export function cooldownHours(hours: number): PanelModalRule {
  const cooldownMs = Math.max(0, hours) * 3_600_000;
  return ({ state, env }) =>
    state.lastShownAt === null || env.now - state.lastShownAt >= cooldownMs;
}

export function onlyMacOSDesktop(): PanelModalRule {
  return ({ env }) => env.hasDesktopBridge && env.platform === 'darwin';
}

export function afterOnboarding(): PanelModalRule {
  return ({ snapshot }) => snapshot.onboardingCompleted;
}

export function onPanelViews(views: readonly PanelView[]): PanelModalRule {
  const allowed = new Set(views);
  return ({ view }) => allowed.has(view);
}

export function withinDateWindow({
  afterIso,
  beforeIso,
}: {
  afterIso?: string;
  beforeIso?: string;
}): PanelModalRule {
  const afterMs = afterIso ? Date.parse(afterIso) : -Infinity;
  const beforeMs = beforeIso ? Date.parse(beforeIso) : Infinity;
  return ({ env }) => env.now >= afterMs && env.now <= beforeMs;
}

function getMacPermissionState(
  snapshot: SettingsSnapshot,
  kind: MacPermissionKind,
): boolean | null {
  return kind === 'accessibility' ? snapshot.accessibilityTrusted : snapshot.screenRecordingTrusted;
}

export function whenMissingMacPermissions(kinds: readonly MacPermissionKind[]): PanelModalRule {
  return ({ snapshot }) =>
    kinds.every((kind) => getMacPermissionState(snapshot, kind) !== null) &&
    kinds.some((kind) => getMacPermissionState(snapshot, kind) === false);
}

export function whenAllMacPermissionsGranted(kinds: readonly MacPermissionKind[]): PanelModalRule {
  return ({ snapshot }) =>
    kinds.length > 0 && kinds.every((kind) => getMacPermissionState(snapshot, kind) === true);
}

export function whenMacPermissionsLoaded(kinds: readonly MacPermissionKind[]): PanelModalRule {
  return ({ snapshot }) => kinds.every((kind) => getMacPermissionState(snapshot, kind) !== null);
}

export function whenMissingModelCredentials(): PanelModalRule {
  return ({ snapshot }) =>
    snapshot.providersLoaded &&
    snapshot.connections.some((connection) => connection.credentialIssue != null);
}

export function whenModelCredentialsHealthy(): PanelModalRule {
  return ({ snapshot }) =>
    snapshot.providersLoaded &&
    snapshot.providerStatusesChecked &&
    snapshot.connections.every((connection) => connection.credentialIssue == null);
}

export function buildPanelModalContext(
  definition: PanelModalDefinition,
  snapshot: SettingsSnapshot,
  view: PanelView,
  states: Record<string, PanelModalState>,
  env: PanelModalEnvironment,
): PanelModalContext {
  return {
    snapshot,
    view,
    state: states[definition.id] ?? EMPTY_PANEL_MODAL_STATE,
    revision: definition.revision,
    env,
  };
}

export function evaluateModalResolved(
  definition: PanelModalDefinition,
  snapshot: SettingsSnapshot | null,
  view: PanelView,
  states: Record<string, PanelModalState>,
  env: PanelModalEnvironment,
): boolean {
  if (!definition.resolved || !snapshot) return false;
  return definition.resolved(buildPanelModalContext(definition, snapshot, view, states, env));
}

export function isPanelModalReopenable(
  definition: PanelModalDefinition,
  snapshot: SettingsSnapshot,
  view: PanelView,
  states: Record<string, PanelModalState>,
  env: PanelModalEnvironment,
): boolean {
  if (definition.reopenable === undefined) return true;
  if (typeof definition.reopenable === 'boolean') return definition.reopenable;
  return definition.reopenable(buildPanelModalContext(definition, snapshot, view, states, env));
}

/** Returns all currently eligible modals sorted by descending priority (stable on ties). */
export function selectEligiblePanelModals(
  definitions: readonly PanelModalDefinition[],
  snapshot: SettingsSnapshot | null,
  view: PanelView,
  states: Record<string, PanelModalState>,
  env: PanelModalEnvironment,
): PanelModalDefinition[] {
  if (!snapshot || !env.windowVisible) return [];
  return [...definitions]
    .sort((a, b) => b.priority - a.priority)
    .filter((definition) =>
      definition.rule(buildPanelModalContext(definition, snapshot, view, states, env)),
    );
}

/** Returns all modals available for manual reopening from the generic macOS menu entry. */
export function selectReopenablePanelModals(
  definitions: readonly PanelModalDefinition[],
  snapshot: SettingsSnapshot | null,
  view: PanelView,
  states: Record<string, PanelModalState>,
  env: PanelModalEnvironment,
): PanelModalDefinition[] {
  if (!snapshot) return [];
  return [...definitions]
    .sort((a, b) => b.priority - a.priority)
    .filter((definition) => isPanelModalReopenable(definition, snapshot, view, states, env));
}

export function withModalImpression(
  states: Record<string, PanelModalState>,
  id: string,
  manual: boolean,
  sawUnresolved: boolean,
  shownAt: number,
): Record<string, PanelModalState> | null {
  if (manual && !sawUnresolved) return null;
  const current = states[id] ?? EMPTY_PANEL_MODAL_STATE;
  if (manual && current.impressions > 0) return null;
  return {
    ...states,
    [id]: {
      ...current,
      impressions: manual ? 1 : current.impressions + 1,
      lastShownAt: manual ? current.lastShownAt : shownAt,
    },
  };
}

export function withReconciledModalCompletions(
  definitions: readonly PanelModalDefinition[],
  states: Record<string, PanelModalState>,
  snapshot: SettingsSnapshot,
  view: PanelView,
  env: PanelModalEnvironment,
  activeIds: ReadonlySet<string>,
): Record<string, PanelModalState> | null {
  let next: Record<string, PanelModalState> | null = null;
  for (const definition of definitions) {
    if (!definition.resolved || activeIds.has(definition.id)) continue;
    const current = (next ?? states)[definition.id] ?? EMPTY_PANEL_MODAL_STATE;
    if (current.impressions === 0 || current.completedRevision === definition.revision) continue;
    if (!evaluateModalResolved(definition, snapshot, view, next ?? states, env)) continue;
    next ??= { ...states };
    next[definition.id] = { ...current, completedRevision: definition.revision };
  }
  return next;
}

export function withClosedModalState(
  states: Record<string, PanelModalState>,
  definition: PanelModalDefinition,
  outcome: 'dismissed' | 'completed',
  manual: boolean,
  now: number,
): Record<string, PanelModalState> {
  const current = states[definition.id] ?? EMPTY_PANEL_MODAL_STATE;
  const revisionPatch =
    outcome === 'completed'
      ? { completedRevision: definition.revision }
      : { dismissedRevision: definition.revision };
  return {
    ...states,
    [definition.id]: {
      ...current,
      impressions: manual ? current.impressions : Math.max(1, current.impressions),
      lastShownAt: manual ? current.lastShownAt : (current.lastShownAt ?? now),
      ...revisionPatch,
    },
  };
}

export function withDismissedAllModalStates(
  states: Record<string, PanelModalState>,
  ids: readonly string[],
  byId: ReadonlyMap<string, PanelModalDefinition>,
  snapshot: SettingsSnapshot | null,
  view: PanelView,
  env: PanelModalEnvironment,
  manual: boolean,
): Record<string, PanelModalState> {
  let next = states;
  for (const id of ids) {
    const definition = byId.get(id);
    if (!definition) continue;
    const resolved =
      snapshot !== null && evaluateModalResolved(definition, snapshot, view, next, env);
    next = withClosedModalState(
      next,
      definition,
      resolved ? 'completed' : 'dismissed',
      manual,
      env.now,
    );
  }
  return next;
}
