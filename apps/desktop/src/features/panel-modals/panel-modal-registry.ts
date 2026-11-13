import { createElement } from 'react';
import { NotarizationReauthModal } from './notarization-reauth-modal';
import {
  afterOnboarding,
  allRules,
  oncePerRevision,
  onPanelViews,
  onlyMacOSDesktop,
  whenAllMacPermissionsGranted,
  whenMissingMacPermissions,
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
      oncePerRevision(),
      onPanelViews(['new', 'task', 'history', 'apps']),
      whenMissingMacPermissions(['accessibility', 'screenRecording']),
    ),
    resolved: whenAllMacPermissionsGranted(['accessibility', 'screenRecording']),
    render: ({ snapshot, onDismiss, onComplete }) =>
      createElement(NotarizationReauthModal, { snapshot, onDismiss, onComplete }),
  },
];
