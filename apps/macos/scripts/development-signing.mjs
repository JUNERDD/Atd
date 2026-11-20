/** One stable, per-user Debug identity, shared by direct builds and the native supervisor. */
import { spawnSync } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const NAME = 'Atd Local Development';
const DIRECTORY = path.join(homedir(), 'Library/Application Support/Atd Development/Signing');
const PIN = path.join(DIRECTORY, 'identity.json');
const KEYCHAIN = path.join(DIRECTORY, 'development.keychain-db');
const PIN_VERSION = 2;

/** Resolve once before computing build receipts; children inherit the exact certificate hash. */
export function configureDevelopmentSigning(log = console.log) {
  const requested = process.env.AI_CODE_SIGN_IDENTITY?.trim();
  if (requested === '-' || (!requested && ['1', 'true'].includes(process.env.CI))) {
    process.env.AI_CODE_SIGN_IDENTITY = '-';
    delete process.env.AI_SIGNING_KEYCHAIN;
    log(
      'Using explicitly requested or CI ad hoc signing; privacy grants will not survive rebuilds.',
    );
    return '-';
  }
  if (requested) {
    const explicitKeychain = process.env.AI_SIGNING_KEYCHAIN?.trim();
    if (explicitKeychain && samePath(explicitKeychain, KEYCHAIN) && existsSync(KEYCHAIN))
      prepareDevelopmentKeychain(KEYCHAIN);
    const identity = resolveRequested(requested, signingIdentities(explicitKeychain));
    process.env.AI_CODE_SIGN_IDENTITY = identity;
    log(`Debug signing identity: ${identity}.`);
    return identity;
  }
  const resolved = resolveLocal(log);
  process.env.AI_CODE_SIGN_IDENTITY = resolved.identity;
  process.env.AI_SIGNING_KEYCHAIN = resolved.keychain;
  log(`Debug signing identity: ${resolved.identity}.`);
  return resolved.identity;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, ...options });
  if (result.error || result.status !== 0)
    throw new Error(
      `${path.basename(command)} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  return result.stdout;
}

function userKeychains() {
  const output = run('/usr/bin/security', ['list-keychains', '-d', 'user']);
  return [...output.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function ensureKeychainListed(keychain, current = userKeychains()) {
  if (current.some((entry) => samePath(entry, keychain))) return;
  run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...current, keychain]);
}

function prepareDevelopmentKeychain(keychain) {
  ensureKeychainListed(keychain);
  run('/usr/bin/security', ['unlock-keychain', '-p', '', keychain]);
}

function signingIdentities(keychain) {
  // A local self-signed identity is intentionally untrusted. `-v` would hide it even though
  // codesign can use its private key and macOS can match its designated requirement.
  const args = ['find-identity', '-p', 'codesigning', ...(keychain ? [keychain] : [])];
  const output = run('/usr/bin/security', args);
  const identities = new Map();
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*\d+\) ([A-Fa-f0-9]{40}) "([^"]+)"(.*)$/);
    if (match)
      identities.set(match[1].toUpperCase(), {
        hash: match[1].toUpperCase(),
        name: match[2],
        problem: match[3].trim(),
      });
  }
  return [...identities.values()];
}

function usable(identity) {
  if (identity.problem && identity.problem !== '(CSSMERR_TP_NOT_TRUSTED)')
    throw new Error(`Signing identity ${identity.hash} is unavailable: ${identity.problem}`);
  return identity.hash;
}

function resolveRequested(requested, identities) {
  const matches = identities.filter(
    ({ hash, name }) => hash === requested.toUpperCase() || name.includes(requested),
  );
  if (matches.length !== 1)
    throw new Error(
      `AI_CODE_SIGN_IDENTITY must name exactly one available certificate; found ${matches.length}.`,
    );
  return usable(matches[0]);
}

function writePin(data) {
  const temporary = `${PIN}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, PIN);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function resolveLocal(log) {
  mkdirSync(DIRECTORY, { recursive: true, mode: 0o700 });
  const lock = path.join(DIRECTORY, 'setup.lock');
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(
      `Development signing setup is already locked at ${lock}. If its process has exited, remove that lock and retry.`,
    );
  }
  try {
    if (existsSync(PIN)) {
      const pin = JSON.parse(readFileSync(PIN, 'utf8'));
      if (pin?.version === PIN_VERSION) {
        if (
          !/^[A-F0-9]{40}$/.test(pin.identity ?? '') ||
          typeof pin.keychain !== 'string' ||
          !pin.keychain.trim()
        )
          throw new Error(`Invalid development signing identity at ${PIN}.`);
        if (!existsSync(pin.keychain))
          throw new Error(
            `The pinned development keychain ${pin.keychain} is missing. Restore it; refusing to replace it and invalidate privacy grants. Pin: ${PIN}`,
          );
        prepareDevelopmentKeychain(pin.keychain);
        const identity = signingIdentities(pin.keychain).find(({ hash }) => hash === pin.identity);
        if (!identity)
          throw new Error(
            `The pinned development certificate ${pin.identity} is missing from ${pin.keychain}. Restore it; refusing to replace it and invalidate privacy grants. Pin: ${PIN}`,
          );
        return { identity: usable(identity), keychain: pin.keychain };
      }
      if (pin?.version === 1 && /^[A-F0-9]{40}$/.test(pin.identity)) {
        const identity = createIdentity(KEYCHAIN, log, true);
        writePin({ version: PIN_VERSION, identity, keychain: KEYCHAIN });
        return { identity, keychain: KEYCHAIN };
      }
      throw new Error(`Invalid development signing identity at ${PIN}.`);
    }
    let identity;
    if (existsSync(KEYCHAIN)) {
      prepareDevelopmentKeychain(KEYCHAIN);
      const matches = signingIdentities(KEYCHAIN).filter(({ name }) => name === NAME);
      if (matches.length > 1)
        throw new Error(
          `Multiple ${NAME} identities exist; select one with AI_CODE_SIGN_IDENTITY.`,
        );
      identity = matches.length === 1 ? usable(matches[0]) : createIdentity(KEYCHAIN, log, false);
    } else {
      identity = createIdentity(KEYCHAIN, log, false);
    }
    writePin({ version: PIN_VERSION, identity, keychain: KEYCHAIN });
    return { identity, keychain: KEYCHAIN };
  } finally {
    rmSync(lock, { force: true });
  }
}

function createIdentity(keychain, log, migrated = false) {
  if (existsSync(keychain)) {
    spawnSync('/usr/bin/security', ['delete-keychain', keychain], { stdio: 'ignore' });
    rmSync(keychain, { force: true });
  }
  const existingKeychains = userKeychains();
  const directory = mkdtempSync(path.join(tmpdir(), 'atd-development-signing-'));
  try {
    const config = path.join(directory, 'certificate.conf');
    const key = path.join(directory, 'private.pem');
    const certificate = path.join(directory, 'certificate.pem');
    const archive = path.join(directory, 'identity.p12');
    writeFileSync(
      config,
      `[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=extensions\n[subject]\nCN=${NAME}\n[extensions]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\nsubjectKeyIdentifier=hash\n`,
      { mode: 0o600 },
    );
    run('/usr/bin/openssl', [
      'req',
      '-new',
      '-x509',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-sha256',
      '-days',
      '3650',
      '-config',
      config,
      '-keyout',
      key,
      '-out',
      certificate,
    ]);
    const archivePassword = randomBytes(32).toString('hex');
    run(
      '/usr/bin/openssl',
      [
        'pkcs12',
        '-export',
        '-inkey',
        key,
        '-in',
        certificate,
        '-out',
        archive,
        '-passout',
        'stdin',
      ],
      { input: `${archivePassword}\n` },
    );
    run('/usr/bin/security', ['create-keychain', '-p', '', keychain]);
    run('/usr/bin/security', ['set-keychain-settings', keychain]);
    run('/usr/bin/security', ['unlock-keychain', '-p', '', keychain]);
    run('/usr/bin/security', [
      'import',
      archive,
      '-k',
      keychain,
      '-P',
      archivePassword,
      '-T',
      '/usr/bin/codesign',
    ]);
    run('/usr/bin/security', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      '',
      keychain,
    ]);
    ensureKeychainListed(keychain, existingKeychains);
    const identity = new X509Certificate(readFileSync(certificate)).fingerprint.replaceAll(':', '');
    const imported = signingIdentities(keychain).find(({ hash }) => hash === identity);
    if (!imported)
      throw new Error('The new development identity could not be found in the keychain.');
    log(
      migrated
        ? 'Migrated Debug signing to a dedicated local development keychain; future builds reuse it.'
        : 'Created a local Debug signing certificate in a dedicated development keychain; future builds reuse it.',
    );
    return usable(imported);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
