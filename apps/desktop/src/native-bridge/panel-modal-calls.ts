/**
 * Native bridge schemas for main-panel feature modals (`panelModal.setAvailable` and
 * `panelModal.open`). Loaded by the export script with Node's type stripping, so it imports nothing
 * but TypeBox and its sibling contract files (by their `.ts` names) and uses only erasable
 * TypeScript syntax.
 */
import { Type, type TSchema } from 'typebox';
import { Empty } from './primitives.ts';

export const NativePanelModalCalls = {
  /**
   * Reports whether any main-panel modal can be reopened from the generic macOS menu item below
   * Welcome Guide, pushed by the panel page on launch.
   */
  'panelModal.setAvailable': {
    params: Type.Object({ available: Type.Boolean() }, { additionalProperties: false }),
    result: Empty,
  },
} satisfies Record<string, { params: TSchema; result: TSchema }>;

export const NativePanelModalEvents = {
  /** Sent to the panel when the user triggers the generic main-panel modals menu item. */
  'panelModal.open': Empty,
} satisfies Record<string, TSchema>;
