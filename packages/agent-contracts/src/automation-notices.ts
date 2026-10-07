import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * Automation notices: what the service wants the person to hear about while the panel may be
 * hidden. The shell pulls them after an `automations` invalidation (shell-only routes), posts a
 * system notification worded from its own String Catalog, and acknowledges them, so a notice is
 * posted once however many windows are open. Opening one shows its task in the panel.
 */

/** Pending notices the service keeps; older unacknowledged ones are dropped. */
export const MAX_AUTOMATION_NOTICES = 50;

/**
 * `delivered`: a run has a result to read. `needsAttention`: a run had to decline actions or skip
 * questions because nobody was present. `failed`: a run failed or ran out of time. `paused`: the
 * service turned the automation off after repeated failures.
 */
export const AutomationNoticeKindSchema = Type.Union([
  Type.Literal('delivered'),
  Type.Literal('needsAttention'),
  Type.Literal('failed'),
  Type.Literal('paused'),
]);
export type AutomationNoticeKind = Static<typeof AutomationNoticeKindSchema>;

export const AutomationNoticeSchema = Type.Object(
  {
    id: Identifier,
    kind: AutomationNoticeKindSchema,
    automationId: Identifier,
    /** The automation's name when the notice was made; user data, never translated. */
    automationName: Type.String({ minLength: 1, maxLength: 120 }),
    /** The task to show when the notification is opened. */
    taskId: Type.Optional(Identifier),
    /** Runtime body text: the opening of the answer, or an error. Not translated. */
    summary: Type.Optional(Type.String({ maxLength: 500 })),
    /** `needsAttention`: how many actions or questions were declined. */
    declined: Type.Optional(Type.Integer({ minimum: 0 })),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
export type AutomationNotice = Static<typeof AutomationNoticeSchema>;

/** GET `/v1/automation-notices` (shell only): unacknowledged notices, oldest first. */
export const AutomationNoticesResponseSchema = Type.Object(
  { notices: Type.Array(AutomationNoticeSchema, { maxItems: MAX_AUTOMATION_NOTICES }) },
  { additionalProperties: false },
);
export type AutomationNoticesResponse = Static<typeof AutomationNoticesResponseSchema>;

/** POST `/v1/automation-notices/ack` (shell only): the notices it posted. Unknown ids are ignored. */
export const AckAutomationNoticesRequestSchema = Type.Object(
  { ids: Type.Array(Identifier, { minItems: 1, maxItems: MAX_AUTOMATION_NOTICES }) },
  { additionalProperties: false },
);
export type AckAutomationNoticesRequest = Static<typeof AckAutomationNoticesRequestSchema>;
