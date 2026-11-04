/**
 * The native bridge's selection toolbar call (`NativeSelectionToolbarCalls`, part of `NativeCalls`
 * in `calls.ts`): what the toolbar over text selected in other apps offers, and how and where it
 * comes up. Loaded by the export script with Node's type stripping, so it imports nothing but
 * TypeBox and its sibling contract files (by their `.ts` names) and uses only erasable TypeScript
 * syntax.
 */
import { Type } from 'typebox';
import { Empty } from './primitives.ts';

export const NativeSelectionToolbarCalls = {
  /**
   * Replaces what the selection toolbar offers over text selected in other apps; the page pushes
   * it whenever it changes. `commands`: the enabled commands that read the selection, in
   * command-list order; clicking one captures the selection and sends `shortcut.command`.
   * `activation` and `activationKeys` gate which selections bring it up
   * (`SelectionToolbarSettingsSchema`); the shell owns the `toggle` mode's listening state, and
   * shows its status HUD while it listens when `showHud` is set. `smallIcon` says whether an
   * admitted selection brings up the whole toolbar or a small icon that grows into it, and
   * `position` where the whole toolbar goes when it comes up at once.
   */
  'toolbar.set': {
    params: Type.Object(
      {
        enabled: Type.Boolean(),
        activation: Type.Union([
          Type.Literal('always'),
          Type.Literal('hold'),
          Type.Literal('toggle'),
        ]),
        activationKeys: Type.Array(
          Type.Union([Type.Literal('option'), Type.Literal('command'), Type.Literal('shift')]),
          { minItems: 1, maxItems: 3 },
        ),
        showHud: Type.Boolean(),
        smallIcon: Type.Union([Type.Literal('off'), Type.Literal('click'), Type.Literal('hover')]),
        position: Type.Union([
          Type.Literal('pointer'),
          Type.Literal('above'),
          Type.Literal('below'),
        ]),
        excludedBundleIds: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
          maxItems: 100,
        }),
        commands: Type.Array(
          Type.Object(
            {
              id: Type.String({ minLength: 1, maxLength: 128 }),
              name: Type.String({ minLength: 1, maxLength: 256 }),
            },
            { additionalProperties: false },
          ),
          { maxItems: 64 },
        ),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
};
