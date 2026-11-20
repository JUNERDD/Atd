import { createElement } from 'react';
import { lazyWithPreload } from '../../lib/lazy-with-preload';
import {
  afterOnboarding,
  allRules,
  anyRule,
  notDismissedInRevision,
  oncePerRevision,
  onPanelViews,
  onlyMacOSDesktop,
  whenAllMacPermissionsGranted,
  whenMacPermissionsLoaded,
  whenMissingMacPermissions,
  whenMissingModelCredentials,
  whenModelCredentialsHealthy,
  type PanelModalDefinition,
} from './panel-modal-rules';

const panelModal = lazyWithPreload(() =>
  import('./panel-modal').then((module) => module.PanelModal),
);
const notarizationReauth = lazyWithPreload(() =>
  import('./notarization-reauth-modal').then((module) => module.NotarizationReauthModal),
);

export const PanelModal = panelModal.Component;
const NotarizationReauthModal = notarizationReauth.Component;

/** Preloads the modal carousel shell and slide chunks after the panel's first frame settles. */
export function preloadPanelModals(): Promise<unknown> {
  return Promise.all([panelModal.preload(), notarizationReauth.preload()]);
}

/**
 * Declarative registry of main-panel feature modals. Add new modals here and tune their popup
 * timing with composable rules (`oncePerRevision`, `cooldownHours`, `maxImpressions`, etc.); bump
 * `revision` whenever a notice (such as a future certificate rotation) should re-prompt users.
 */
export const PANEL_MODAL_DEFINITIONS: readonly PanelModalDefinition[] = [
  {
    id: 'notarization-reauth',
    revision: 1,
    priority: 100,
    hasMedia: true,
    reopenable: onlyMacOSDesktop(),
    rule: allRules(
      onlyMacOSDesktop(),
      afterOnboarding(),
      onPanelViews(['new', 'task', 'history', 'apps']),
      whenMacPermissionsLoaded(['accessibility', 'screenRecording']),
      anyRule(
        allRules(
          oncePerRevision(),
          whenMissingMacPermissions(['accessibility', 'screenRecording']),
        ),
        allRules(notDismissedInRevision(), whenMissingModelCredentials()),
      ),
    ),
    unresolved: anyRule(
      whenMissingMacPermissions(['accessibility', 'screenRecording']),
      whenMissingModelCredentials(),
    ),
    resolved: allRules(
      whenAllMacPermissionsGranted(['accessibility', 'screenRecording']),
      whenModelCredentialsHealthy(),
    ),
    render: ({ snapshot, onDismiss, onComplete }) =>
      createElement(NotarizationReauthModal, { snapshot, onDismiss, onComplete }),
  },
];
