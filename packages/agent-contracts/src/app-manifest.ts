import { Type, type Static } from 'typebox';
import {
  APP_DESCRIPTION_MAX_LENGTH,
  AppAccentColorSchema,
  AppNameSchema,
  CapabilitySchema,
} from './app-identity.js';

/**
 * `atd-app.json`, the manifest at the root of an app's source: written by the agent, validated by
 * every build, and kept with each version's source. The app records (`apps.ts`) take the name,
 * description, accent color, window, capabilities and purposes from it.
 */

const WindowLength = Type.Integer({ minimum: 200, maximum: 4000 });

/** The window size the manifest asks for, in points; the shell clamps it to the work area. */
export const AppWindowSchema = Type.Object(
  {
    width: WindowLength,
    height: WindowLength,
    minWidth: Type.Optional(WindowLength),
    minHeight: Type.Optional(WindowLength),
  },
  { additionalProperties: false },
);
export type AppWindow = Static<typeof AppWindowSchema>;

/** The window size the service resolved, minimums filled from the manifest or its defaults. */
export const AppRuntimeWindowSchema = Type.Object(
  { width: WindowLength, height: WindowLength, minWidth: WindowLength, minHeight: WindowLength },
  { additionalProperties: false },
);
export type AppRuntimeWindow = Static<typeof AppRuntimeWindowSchema>;

/** Why the app uses a capability, shown in its consent; at most one line of plain text. */
export const AppPurposeSchema = Type.String({ minLength: 1, maxLength: 300 });

/** The most npm packages one app may declare. */
export const APP_MAX_DEPENDENCIES = 24;

/** An npm package name, optionally scoped, lowercase and at most 214 characters (npm's rules). */
export const AppDependencyNameSchema = Type.String({
  maxLength: 214,
  pattern: '^(?=.{1,214}$)(?:@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$',
});

/**
 * The versions an app accepts for a package: an exact version, a `^` or `~` range, or an x-range
 * (`4`, `4.1`, `4.x`), with an optional prerelease. Tags, `*`, `||`, comparators, URLs, git,
 * `file:` and `npm:` aliases are refused, so a declaration can only select registry releases.
 */
export const AppDependencyRangeSchema = Type.String({
  maxLength: 64,
  pattern: '^[~^]?(0|[1-9]\\d*)(\\.(0|[1-9]\\d*|x)){0,2}(-[0-9A-Za-z.-]+)?$',
});

/** The manifest's `dependencies`: package name → accepted versions. */
export const AppDependenciesSchema = Type.Record(
  AppDependencyNameSchema,
  AppDependencyRangeSchema,
  {
    maxProperties: APP_MAX_DEPENDENCIES,
    // A patterned key alone lets other keys through; this refuses them.
    additionalProperties: false,
  },
);
export type AppDependencies = Static<typeof AppDependenciesSchema>;

/**
 * `capabilities` lists the consent-gated services the backend may use; a capability request the
 * manifest does not list fails without asking. `purposes` optionally explains each one to the
 * user in its consent. `accentColor` is the app's identity color; without one the app keeps the
 * neutral theme. `dependencies` names the npm packages the app imports besides those Atd
 * provides; the build installs them (app-kit `prepareDependencies` refuses provided, toolchain
 * and `@atd` packages), and an app without the field builds exactly as before it existed.
 */
export const AppManifestSchema = Type.Object(
  {
    name: AppNameSchema,
    description: Type.String({ maxLength: APP_DESCRIPTION_MAX_LENGTH }),
    accentColor: Type.Optional(AppAccentColorSchema),
    window: AppWindowSchema,
    capabilities: Type.Array(CapabilitySchema, { maxItems: 5, uniqueItems: true }),
    purposes: Type.Optional(
      Type.Object(
        {
          ai: Type.Optional(AppPurposeSchema),
          agent: Type.Optional(AppPurposeSchema),
          memory: Type.Optional(AppPurposeSchema),
          mcp: Type.Optional(AppPurposeSchema),
          web: Type.Optional(AppPurposeSchema),
        },
        { additionalProperties: false },
      ),
    ),
    dependencies: Type.Optional(AppDependenciesSchema),
  },
  { additionalProperties: false },
);
export type AppManifest = Static<typeof AppManifestSchema>;
