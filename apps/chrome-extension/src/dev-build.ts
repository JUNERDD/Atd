/**
 * The dev flavor's build stamp: every dev build writes it into `dist/dev` once everything else is
 * written (`dev-plugins.ts`), and the dev service worker reloads the extension when it changes
 * (`background/dev-reload.ts`). The release flavor has none.
 */
export const DEV_BUILD_FILE = 'dev-build.json';

export interface DevBuild {
  /** Distinct for every build. */
  build: string;
}

export function isDevBuild(value: unknown): value is DevBuild {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'build') === 'string'
  );
}
