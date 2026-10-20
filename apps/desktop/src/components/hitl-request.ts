import { SHOW_UI_TOOL, type AppCapabilityConsent } from '@atd/agent-contracts';
import type { InputRequest, PermissionRequest } from '../client/agent/permission-schema';
import type { Block } from '../client/agent/transcript-schema';

/**
 * What the composer's HITL view asks the user about: the open task's requests (tool approvals and
 * `ask_user` questions), and the capability consents apps wait on. A consent belongs to an app,
 * not to the task, so it shows in every conversation until it is answered (`AppSummary.consents`).
 * A view that waits for the user's response (`show_ui` with `wait`) raises an input request too,
 * but it is answered in the view's window, so it shows as a `view` request that opens it.
 */
export type HitlRequest =
  | PermissionRequest
  | { kind: 'appConsent'; id: string; consent: AppCapabilityConsent }
  | { kind: 'view'; id: string; request: InputRequest };

/** A pending app consent as a HITL request; its id is the consent's. */
export function consentRequest(consent: AppCapabilityConsent): HitlRequest {
  return { kind: 'appConsent', id: consent.id, consent };
}

/**
 * The task's requests as the HITL view shows them: an input request whose call is a `show_ui` call
 * of the task's transcript becomes a `view` request with the same id. The list comes back as it was
 * while no view waits, so its consumers keep it across transcript patches.
 */
export function taskHitlRequests(
  requests: readonly PermissionRequest[],
  blocks: readonly Block[],
): readonly HitlRequest[] {
  if (!requests.some((request) => request.kind === 'input')) return requests;
  const views = new Set<string>();
  for (const block of blocks)
    if (block.kind === 'tool' && block.name === SHOW_UI_TOOL) views.add(block.callId);
  if (!requests.some((request) => request.kind === 'input' && views.has(request.toolCallId)))
    return requests;
  return requests.map((request) =>
    request.kind === 'input' && views.has(request.toolCallId)
      ? { kind: 'view', id: request.id, request }
      : request,
  );
}
