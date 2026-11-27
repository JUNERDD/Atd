import { Type, type Static } from 'typebox';
import {
  DIAG_CAT_MAX,
  DIAG_CODE_MAX,
  DIAG_MSG_MAX,
  DiagLevelSchema,
} from '../channel/diagnostics.ts';

/**
 * Bounded diagnostic intent sent from content script, panel, or options page to the background
 * service worker over its existing port. Checked with `Value.Check` on arrival; the background
 * enriches `content` events with `tabId` and `origin` strictly from `port.sender.tab`.
 */
export const DiagEventMessageSchema = Type.Object({
  type: Type.Literal('diag.event'),
  level: DiagLevelSchema,
  cat: Type.String({ minLength: 1, maxLength: DIAG_CAT_MAX }),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: DIAG_CODE_MAX })),
  msg: Type.String({ minLength: 1, maxLength: DIAG_MSG_MAX }),
});
export type DiagEventMessage = Static<typeof DiagEventMessageSchema>;
