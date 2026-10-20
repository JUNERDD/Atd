import { Type, type Static } from 'typebox';

/**
 * Add-ons: optional, first-party parts of the product that the installer does not carry and the
 * service downloads, verifies and activates while the app runs. Each build pins the exact archive
 * of every add-on it can use (`AddonLock`, shipped inside the service pack), so the app's own
 * signature covers what may be installed: an archive is accepted only when its SHA-256 and size
 * match the lock, and only files its inner manifest lists, with matching hashes, are activated.
 *
 * The service owns the install state under `<dataDir>/addons`. Consumers read `AddonView`:
 * the shell resolves native entry points from it (`GET /v1/addons`, reloaded on the `addons`
 * invalidation), and service features gate their tools and skills on `installed`. Removing or
 * replacing an add-on never needs a restart: consumers stop using it when it leaves `installed`.
 */

/** Add-on identifiers: lowercase words joined by `-`. */
export const AddonIdSchema = Type.String({
  pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
  maxLength: 64,
});
export type AddonId = Static<typeof AddonIdSchema>;

/** The browser engine of computer use: the CDP worker the shell runs with the app's own Node. */
export const COMPUTER_BROWSER_ADDON = 'computer-browser';
/**
 * The add-ons that provide a computer-use engine. The native engine (`atd`) ships inside the app,
 * so only the browser engine is an add-on; gates stay driven by this list.
 */
export const COMPUTER_ADDONS = [COMPUTER_BROWSER_ADDON] as const;

export const AddonArchSchema = Type.Union([Type.Literal('arm64'), Type.Literal('x64')]);
export type AddonArch = Static<typeof AddonArchSchema>;

const Sha256 = Type.String({ pattern: '^[0-9a-f]{64}$' });
/** A path inside an add-on: relative, `/`-separated, no `.`/`..` segments or leading `/`. */
export const AddonRelativePathSchema = Type.String({
  pattern: '^(?!/)(?!.*(^|/)\\.{1,2}(/|$))[A-Za-z0-9._@+-]+(/[A-Za-z0-9._@+-]+)*$',
  maxLength: 512,
});
/** Named entry points an add-on's consumers resolve, such as `worker`. */
const EntryName = Type.String({ pattern: '^[a-z][a-zA-Z0-9]*$', maxLength: 32 });
const MAX_ENTRIES = 8;
const MAX_FILES = 2000;
/** Download and unpacked size ceiling for one add-on. */
export const ADDON_MAX_BYTES = 512 * 1024 * 1024;

/** One add-on archive a build can install. `urls` are tried in order; any serving bytes that
 * match `sha256` and `size` will do (`https:`, or `file:` in development builds). */
export const AddonArtifactSchema = Type.Object(
  {
    id: AddonIdSchema,
    /** Shown to people; identity is `sha256`. */
    version: Type.String({ minLength: 1, maxLength: 64 }),
    arch: AddonArchSchema,
    sha256: Sha256,
    size: Type.Integer({ minimum: 1, maximum: ADDON_MAX_BYTES }),
    unpackedSize: Type.Integer({ minimum: 1, maximum: ADDON_MAX_BYTES }),
    urls: Type.Array(Type.String({ pattern: '^(https|file):', maxLength: 2048 }), {
      minItems: 1,
      maxItems: 4,
    }),
  },
  { additionalProperties: false },
);
export type AddonArtifact = Static<typeof AddonArtifactSchema>;

/** `addons.lock.json`: the archives this build accepts, at most one per id and architecture. */
export const AddonLockSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    addons: Type.Array(AddonArtifactSchema, { maxItems: 32 }),
  },
  { additionalProperties: false },
);
export type AddonLock = Static<typeof AddonLockSchema>;

/**
 * `addon.json` at an archive's root. Every regular file the archive holds is listed with its hash;
 * anything else (unlisted files, links, devices) rejects the archive. `executables` get mode 0755,
 * every other file 0644. `entries` name the files consumers start or load.
 */
export const AddonManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: AddonIdSchema,
    version: Type.String({ minLength: 1, maxLength: 64 }),
    arch: AddonArchSchema,
    entries: Type.Record(EntryName, AddonRelativePathSchema, { maxProperties: MAX_ENTRIES }),
    executables: Type.Array(AddonRelativePathSchema, { maxItems: MAX_ENTRIES }),
    files: Type.Array(
      Type.Object(
        {
          path: AddonRelativePathSchema,
          sha256: Sha256,
          size: Type.Integer({ minimum: 0, maximum: ADDON_MAX_BYTES }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: MAX_FILES },
    ),
  },
  { additionalProperties: false },
);
export type AddonManifest = Static<typeof AddonManifestSchema>;

/** What the service is doing with an add-on right now. */
export const AddonPhaseSchema = Type.Union([
  Type.Literal('idle'),
  Type.Literal('downloading'),
  Type.Literal('verifying'),
  Type.Literal('installing'),
  Type.Literal('removing'),
]);
export type AddonPhase = Static<typeof AddonPhaseSchema>;

/**
 * Why the last install or removal failed. `inUse`: a consumer reported work in progress, so the
 * add-on stayed; `unavailable`: this build ships no archive for this Mac.
 */
export const AddonErrorCodeSchema = Type.Union([
  Type.Literal('network'),
  Type.Literal('integrity'),
  Type.Literal('disk'),
  Type.Literal('unavailable'),
  Type.Literal('inUse'),
  Type.Literal('cancelled'),
  Type.Literal('internal'),
]);
export type AddonErrorCode = Static<typeof AddonErrorCodeSchema>;

/** One add-on as consumers see it. */
export const AddonViewSchema = Type.Object(
  {
    id: AddonIdSchema,
    /** This build ships an archive for this Mac's architecture. */
    available: Type.Boolean(),
    /** The version and download size this build installs, when `available`. */
    version: Type.Optional(Type.String({ maxLength: 64 })),
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    phase: AddonPhaseSchema,
    /** Bytes received of `total` while `downloading`. */
    progress: Type.Optional(
      Type.Object(
        { received: Type.Integer({ minimum: 0 }), total: Type.Integer({ minimum: 0 }) },
        { additionalProperties: false },
      ),
    ),
    /**
     * The active install, present only when it is exactly the archive this build pins. `root` and
     * `entries` are absolute paths under the service's `addons` directory.
     */
    installed: Type.Optional(
      Type.Object(
        {
          version: Type.String({ maxLength: 64 }),
          sha256: Sha256,
          root: Type.String({ maxLength: 4096 }),
          entries: Type.Record(EntryName, Type.String({ maxLength: 4096 }), {
            maxProperties: MAX_ENTRIES,
          }),
        },
        { additionalProperties: false },
      ),
    ),
    /**
     * An installed archive this build no longer uses (after an app update). It is never active;
     * the service replaces it on its own when this build ships a newer archive for the add-on.
     */
    outdated: Type.Optional(
      Type.Object({ version: Type.String({ maxLength: 64 }) }, { additionalProperties: false }),
    ),
    /** The last install or removal that failed; cleared when the next one starts. */
    error: Type.Optional(
      Type.Object(
        { code: AddonErrorCodeSchema, message: Type.String({ maxLength: 500 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type AddonView = Static<typeof AddonViewSchema>;

/** GET `/v1/addons` (renderer and shell). */
export const AddonListResponseSchema = Type.Object(
  { addons: Type.Array(AddonViewSchema, { maxItems: 32 }) },
  { additionalProperties: false },
);
export type AddonListResponse = Static<typeof AddonListResponseSchema>;

/**
 * POST `/v1/addons/:id/install` and `/cancel`, DELETE `/v1/addons/:id` (renderer). Install starts
 * a download, or joins the one running, and answers at once with the add-on's view; the outcome
 * arrives through the `addons` invalidation. Removal answers 409 with `error.code: 'inUse'` while
 * a consumer still uses the add-on.
 */
export const AddonResponseSchema = Type.Object(
  { addon: AddonViewSchema },
  { additionalProperties: false },
);
export type AddonResponse = Static<typeof AddonResponseSchema>;
