import type { AuthContext } from '@earendil-works/pi-ai';
import type { ServiceConnection } from '@atd/agent-contracts';

/** Saved connections opt in to environment and default-file discovery together. */
export function connectionAuthContext(
  connection: Pick<ServiceConnection, 'provider' | 'authType' | 'options'>,
  context: AuthContext,
  options: Readonly<Record<string, string>> = connection.options ?? {},
): AuthContext {
  return {
    env: (name) =>
      options[name] !== undefined
        ? Promise.resolve(options[name])
        : connection.authType === 'ambient'
          ? context.env(name)
          : Promise.resolve(undefined),
    fileExists: (file) => {
      if (connection.provider !== 'google-vertex' || connection.authType === 'ambient')
        return context.fileExists(file);
      // Pi's Vertex resolver falls back to gcloud's default ADC file even without env vars.
      // An explicit credentials path is allowed; implicit filesystem discovery is ambient auth.
      const explicit = options.GOOGLE_APPLICATION_CREDENTIALS;
      return explicit && file === explicit ? context.fileExists(file) : Promise.resolve(false);
    },
  };
}
