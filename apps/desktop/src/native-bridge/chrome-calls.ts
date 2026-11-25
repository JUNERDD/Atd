/**
 * Atd for Chrome across the native bridge (`contract.ts`): the Chrome extension that makes the
 * person's own Chrome a browser channel of computer use. The shell owns the connection (the Native
 * Messaging host manifest it installs at launch, the pairings it confirmed in a native dialog) and
 * reports it in `computer.state` (`chrome`); Settings › Computer use only lists the paired Chrome
 * profiles and disconnects one. Pairing never starts from the page: the person starts it in the
 * extension and confirms it in the shell's dialog. Like the rest of the contract, the export
 * script loads this file with Node's type stripping, so it imports nothing but TypeBox and uses
 * only erasable TypeScript syntax.
 */
import { Type } from 'typebox';

/** A pairing's `installationId`: an agent-contracts `Identifier`, the extension's own per profile. */
const InstallationIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_-]+$',
});

/** An ISO 8601 instant, as `Date.prototype.toISOString` writes it. */
const DateTimeSchema = Type.String({ format: 'date-time', maxLength: 64 });

/**
 * The Chrome channel as the shell sees it. `hostManifest`: whether Chromium browsers can reach
 * this app's native host: `installed` (the manifest is in place for every discovered browser),
 * `chromeMissing` (no Chromium browser profile folder exists), `blockedLocation` (the app runs
 * translocated or from Documents, Desktop or Downloads, where browsers may not start it, so
 * nothing was written) or `failed` (writing it failed). `browsers`: deduplicated, sorted display
 * names of the Chromium browsers whose host manifest was written. `extensionIds.expected`: the one
 * extension ID this build's host manifest allows, the dev flavor's for a Debug build and the
 * release flavor's otherwise. `connections`: one entry per paired browser profile, `label` being
 * the profile's email or the browser's name, `email` present only when the person shared it at
 * Connect, `browser` the browser's name (Google Chrome, Arc, Aside, …), `connected` whether its
 * extension holds a live connection now, `lastSeenAt` when it last did, and `sites` how many
 * sites the person allowed from the extension (its site bindings).
 */
export const ComputerChromeStateSchema = Type.Object(
  {
    hostManifest: Type.Union([
      Type.Literal('installed'),
      Type.Literal('chromeMissing'),
      Type.Literal('blockedLocation'),
      Type.Literal('failed'),
    ]),
    browsers: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 32 }),
    extensionIds: Type.Object(
      { expected: Type.String({ minLength: 32, maxLength: 32, pattern: '^[a-p]{32}$' }) },
      { additionalProperties: false },
    ),
    connections: Type.Array(
      Type.Object(
        {
          installationId: InstallationIdSchema,
          label: Type.String({ minLength: 1, maxLength: 320 }),
          email: Type.Optional(Type.String({ minLength: 1, maxLength: 320 })),
          browser: Type.String({ minLength: 1, maxLength: 120 }),
          connected: Type.Boolean(),
          lastSeenAt: DateTimeSchema,
          sites: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 32 },
    ),
  },
  { additionalProperties: false },
);

export const NativeChromeCalls = {
  /**
   * Disconnects a paired browser profile on the person's click in Settings: the shell deletes the
   * pairing and the site bindings it allowed, tells a connected extension it is unpaired, and
   * reports the new `computer.state`.
   */
  'computer.chrome.disconnect': {
    params: Type.Object({ installationId: InstallationIdSchema }, { additionalProperties: false }),
    result: Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
  },
  /**
   * Re-scans Chromium browsers and re-writes the Native Messaging host manifests on demand, then
   * reports the updated `computer.state`.
   */
  'computer.chrome.refresh': {
    params: Type.Object({}, { additionalProperties: false }),
    result: Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
  },
};
