import { createElement } from 'react';
import { NotarizationReauthModal } from './notarization-reauth-modal';
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
