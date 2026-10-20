import { Type, type Static } from 'typebox';
import { ComputerRefIdSchema } from './computer-actions.js';

/**
 * Surfaces of a target: its root window and the sheets, dialogs, panels, menus, popovers and
 * windows the host attributes to it. A surface is derived from a live `TargetRef` and minted by
 * the host for one generation; it never replaces the binding and never widens what the run may
 * act on.
 */

/** Surfaces one observation lists. */
export const COMPUTER_MAX_SURFACES = 16;

export const ComputerSurfaceKindSchema = Type.Union([
  Type.Literal('window'),
  Type.Literal('sheet'),
  Type.Literal('dialog'),
  Type.Literal('panel'),
  Type.Literal('menu'),
  Type.Literal('popover'),
]);
export type ComputerSurfaceKind = Static<typeof ComputerSurfaceKindSchema>;

/**
 * Why the host attributes a surface to the target: it is the `root` window, a sheet attached to
 * a surface, a window owned by the target's process, a panel a system service shows for it, or a
 * surface an action of this run opened.
 */
export const ComputerSurfaceBasisSchema = Type.Union([
  Type.Literal('root'),
  Type.Literal('attachedSheet'),
  Type.Literal('ownedWindow'),
  Type.Literal('servicePanel'),
  Type.Literal('openedByAction'),
]);
export type ComputerSurfaceBasis = Static<typeof ComputerSurfaceBasisSchema>;

/**
 * One surface. `parentId` names the surface it belongs to (absent for the root); `pid` with
 * `processStart` is the process actually showing it, which may differ from the target's for a
 * service panel; `generation` bumps whenever the host re-identifies it. While a `modal` child is
 * open, writes to its parent fail with `modalBlocked`.
 */
export const SurfaceRefSchema = Type.Object(
  {
    id: ComputerRefIdSchema,
    targetRefId: ComputerRefIdSchema,
    parentId: Type.Optional(ComputerRefIdSchema),
    kind: ComputerSurfaceKindSchema,
    title: Type.Optional(Type.String({ maxLength: 200 })),
    pid: Type.Integer({ minimum: 1 }),
    processStart: Type.String({ minLength: 1, maxLength: 64 }),
    windowId: Type.Optional(Type.Integer({ minimum: 0 })),
    generation: Type.Integer({ minimum: 1 }),
    basis: ComputerSurfaceBasisSchema,
    modal: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SurfaceRef = Static<typeof SurfaceRefSchema>;
