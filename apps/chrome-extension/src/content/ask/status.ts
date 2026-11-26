import type { AskFailure, PanelSurface, TabView } from '../../messages/views.ts';
import { t } from '../i18n.ts';

/** Atd takes one request per browser at a time, and only while connected and paired. */
export function canAsk(view: TabView | null): boolean {
  return blockedCopy(view) === null;
}

/**
 * Why Atd cannot take a request from this tab right now, in the person's words, or null when it
 * can. The in-page ask shows it with send disabled; the panel has the details and the remedies
 * (Connect…, Reconnect).
 */
export function blockedCopy(view: TabView | null): string | null {
  if (view === null) return t('ask.blocked.connecting');
  switch (view.connection) {
    case 'ready':
      break;
    case 'connecting':
      return t('ask.blocked.connecting');
    case 'otherHost':
      return t('ask.blocked.otherHost');
    case 'serviceUnavailable':
      return t('ask.blocked.serviceUnavailable');
    case 'hostMissing':
      return t('ask.blocked.hostMissing');
    case 'browserNotVerified':
    case 'browserMismatch':
    case 'disconnected':
      return t('ask.blocked.notConnected');
  }
  if (!view.paired) return t('ask.blocked.notPaired');
  return view.busy ? t('ask.blocked.busy') : null;
}

/** Why Atd did not take the request, in the person's words: never the code itself. */
export function failureCopy(reason: AskFailure | undefined): string {
  switch (reason) {
    case 'notConnected':
      return t('ask.failure.notConnected');
    case 'notPaired':
      return t('ask.failure.notPaired');
    case 'tooLong':
      return t('ask.failure.tooLong');
    case 'otherHost':
      return t('ask.failure.otherHost');
    case 'serviceUnavailable':
      return t('ask.failure.serviceUnavailable');
    case 'failed':
    case undefined:
    default:
      // A code this version does not know reads as the generic failure too.
      return t('ask.failure.failed');
  }
}

/** The name of the control that opens Atd's panel where it opens. */
export function panelLabel(panel: PanelSurface): string {
  return panel === 'sidePanel' ? t('ask.openSidePanel') : t('ask.openPanel');
}
