import type { AppCapabilityConsent } from '@atd/agent-contracts';
import type { PermissionRequest } from '../client/agent/permission-schema';

/**
 * What the composer's HITL view asks the user about: the open task's requests (tool approvals and
 * `ask_user` questions), and the capability consents apps wait on. A consent belongs to an app,
 * not to the task, so it shows in every conversation until it is answered (`AppSummary.consents`).
 */
export type HitlRequest =
  | PermissionRequest
  | { kind: 'appConsent'; id: string; consent: AppCapabilityConsent };

/** A pending app consent as a HITL request; its id is the consent's. */
export function consentRequest(consent: AppCapabilityConsent): HitlRequest {
  return { kind: 'appConsent', id: consent.id, consent };
}
