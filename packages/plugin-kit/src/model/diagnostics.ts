import { Type, type Static } from 'typebox';

/**
 * Stable diagnostic codes. Adapters and the installer never throw for a problem that affects one
 * component: they skip it and report one of these, so a partly valid plugin still loads.
 *
 * - `unknown-field`: a manifest field this format version does not define; ignored.
 * - `unsupported-component`: a component type the kit does not import (hooks, `bin/`, LSP,
 *   output styles, pi extensions/themes, reverse-domain extension directories, …); ignored.
 * - `unsupported-transport`: an MCP server whose transport has no normalized form (`ws`,
 *   `headersHelper`, `oauth`, `.mcpb`); skipped.
 * - `invalid-component`: a component that failed its own validation; skipped.
 * - `path-escape`: a path that resolves outside the plugin root; skipped (or fatal for the root).
 * - `renamed`: a name normalized to the kit alphabet; the item loads under the new name.
 * - `duplicate`: two components of one kind with the same name; the later one is skipped.
 * - `shell-injection`: Claude `` !`cmd` `` / ```` ```! ```` prompt blocks; kept as literal text,
 *   never executed.
 * - `needs-config`: a required user config value is missing.
 * - `collision`: two plugins resolve to the same qualified name (resolution only).
 * - `invalid-manifest`: the manifest is unusable; the whole plugin is rejected.
 */
export const PluginDiagnosticCodeSchema = Type.Union([
  Type.Literal('unknown-field'),
  Type.Literal('unsupported-component'),
  Type.Literal('unsupported-transport'),
  Type.Literal('invalid-component'),
  Type.Literal('path-escape'),
  Type.Literal('renamed'),
  Type.Literal('duplicate'),
  Type.Literal('shell-injection'),
  Type.Literal('needs-config'),
  Type.Literal('collision'),
  Type.Literal('invalid-manifest'),
]);
export type PluginDiagnosticCode = Static<typeof PluginDiagnosticCodeSchema>;

export const PluginDiagnosticSchema = Type.Object(
  {
    level: Type.Union([Type.Literal('error'), Type.Literal('warning'), Type.Literal('info')]),
    code: PluginDiagnosticCodeSchema,
    message: Type.String({ maxLength: 2000 }),
    /** Plugin-root-relative POSIX path the diagnostic is about, when there is one. */
    path: Type.Optional(Type.String({ maxLength: 1024 })),
    /** Component kind and name the diagnostic is about, when there is one. */
    component: Type.Optional(
      Type.Object(
        { kind: Type.String({ maxLength: 32 }), name: Type.String({ maxLength: 256 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type PluginDiagnostic = Static<typeof PluginDiagnosticSchema>;
