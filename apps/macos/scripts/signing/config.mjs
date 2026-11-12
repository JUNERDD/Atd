/** Machine-local signing settings, shared by all checkouts; private keys stay in Keychain. */
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const configFile =
  process.env.AI_SIGNING_CONFIG ||
  path.join(homedir(), 'Library/Application Support/Atd Signing/config.json');

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0)
    throw new Error(
      `${path.basename(command)} failed: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`,
    );
  return result.stdout;
}

export function signingConfig(env = process.env, file = configFile) {
  const local = !env.CI && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (local.version !== undefined && local.version !== 1)
    throw new Error('Unsupported signing config version.');
  const config = {
    identity: env.AI_CODE_SIGN_IDENTITY?.trim() || local.identity,
    teamId: env.AI_DEVELOPMENT_TEAM?.trim() || local.teamId,
    keychain: env.AI_SIGNING_KEYCHAIN || local.keychain,
    notaryProfile: env.AI_NOTARY_PROFILE || local.notaryProfile,
    notaryKeychain: env.AI_NOTARY_KEYCHAIN || local.notaryKeychain,
  };
  for (const [name, value] of Object.entries(config))
    if (value !== undefined && (typeof value !== 'string' || !value.trim()))
      throw new Error(`Invalid signing setting: ${name}.`);
  return config;
}

/** Require the exact, valid Apple identity, including its private key and expected team. */
export function validateIdentity(config) {
  if (
    !/^[A-Fa-f0-9]{40}$/.test(config.identity ?? '') ||
    !/^[A-Z0-9]{10}$/.test(config.teamId ?? '')
  )
    throw new Error('Configure a Developer ID certificate SHA-1 and Team ID with signing:setup.');
  const keychain = config.keychain ? [config.keychain] : [];
  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning', ...keychain]);
  const hash = config.identity.toUpperCase();
  if (!identities.includes(`${hash} "Developer ID Application:`))
    throw new Error(
      'The configured Developer ID identity is missing, expired or locked. Import the .p12 and unlock its keychain.',
    );
  const pem = run('security', ['find-certificate', '-a', '-p', ...keychain]);
  const certificates = (
    pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
  ).map((value) => new X509Certificate(value));
  const certificate = certificates.find((value) => value.fingerprint.replaceAll(':', '') === hash);
  if (
    !certificate ||
    !certificate.subject.split('\n').includes(`OU=${config.teamId}`) ||
    !certificate.subject
      .split('\n')
      .some((line) => line.startsWith('CN=Developer ID Application:')) ||
    !certificate.issuer.includes('CN=Developer ID Certification Authority')
  )
    throw new Error('The certificate does not belong to the configured Developer ID team.');
  return { ...config, identity: hash };
}

/** Apply before Xcode and before the dev supervisor computes its signing-sensitive receipt. */
export function configureSigning(configuration) {
  // Explicit Debug overrides retain their existing local-development semantics.
  if (configuration === 'Debug' && process.env.AI_CODE_SIGN_IDENTITY?.trim()) return null;
  const config = signingConfig();
  if (config.identity === '-') return null; // Explicit unsigned packaging rehearsal only.
  if (!config.identity && configuration === 'Debug') return null;
  const valid = validateIdentity(config);
  process.env.AI_CODE_SIGN_IDENTITY = valid.identity;
  process.env.AI_DEVELOPMENT_TEAM = valid.teamId;
  return valid;
}

export function notaryArgs(config = signingConfig()) {
  if (!config.notaryProfile)
    throw new Error('No notarization profile. Run signing:setup --credentials.');
  return [
    '--keychain-profile',
    config.notaryProfile,
    ...(config.notaryKeychain ? ['--keychain', config.notaryKeychain] : []),
  ];
}
