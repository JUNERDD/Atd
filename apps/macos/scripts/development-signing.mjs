/** One stable, per-user Debug identity, shared by direct builds and the native supervisor. */
import { spawnSync } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const NAME = 'Atd Local Development';
const DIRECTORY = path.join(homedir(), 'Library/Application Support/Atd Development/Signing');
const PIN = path.join(DIRECTORY, 'identity.json');

/** Resolve once before computing build receipts; children inherit the exact certificate hash. */
export function configureDevelopmentSigning(log = console.log) {
  const requested = process.env.AI_CODE_SIGN_IDENTITY?.trim();
  if (requested === '-' || (!requested && ['1', 'true'].includes(process.env.CI))) {
    process.env.AI_CODE_SIGN_IDENTITY = '-';
    log(
      'Using explicitly requested or CI ad hoc signing; privacy grants will not survive rebuilds.',
    );
    return '-';
  }
  const identity = requested ? resolveRequested(requested, signingIdentities()) : resolveLocal(log);
  process.env.AI_CODE_SIGN_IDENTITY = identity;
  log(`Debug signing identity: ${identity}.`);
  return identity;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, ...options });
  if (result.error || result.status !== 0)
    throw new Error(
      `${path.basename(command)} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  return result.stdout;
}

function signingIdentities() {
  // A local self-signed identity is intentionally untrusted. `-v` would hide it even though
  // codesign can use its private key and macOS can match its designated requirement.
  const output = run('/usr/bin/security', ['find-identity', '-p', 'codesigning']);
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
    const identities = signingIdentities();
    if (existsSync(PIN)) {
      const pin = JSON.parse(readFileSync(PIN, 'utf8'));
      if (!pin || pin.version !== 1 || !/^[A-F0-9]{40}$/.test(pin.identity))
        throw new Error(`Invalid development signing identity at ${PIN}.`);
      const identity = identities.find(({ hash }) => hash === pin.identity);
      if (!identity)
        throw new Error(
          `The pinned development certificate ${pin.identity} is missing or its keychain is locked. Unlock or restore it; refusing to replace it and invalidate privacy grants. Pin: ${PIN}`,
        );
      return usable(identity);
    }
    const matches = identities.filter(({ name }) => name === NAME);
    if (matches.length > 1)
      throw new Error(`Multiple ${NAME} identities exist; select one with AI_CODE_SIGN_IDENTITY.`);
    const identity = matches.length === 1 ? usable(matches[0]) : createIdentity(log);
    writeFileSync(PIN, `${JSON.stringify({ version: 1, identity })}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    return identity;
  } finally {
    rmSync(lock, { force: true });
  }
}

function createIdentity(log) {
  const keychain = run('/usr/bin/security', ['default-keychain', '-d', 'user'])
    .trim()
    .replace(/^"(.*)"$/, '$1');
  if (!keychain) throw new Error('No default user keychain is available for development signing.');
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
    const password = randomBytes(32).toString('hex');
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
      { input: `${password}\n` },
    );
    // Restrict key access to codesign. macOS may ask the user to allow its first use; the key
    // is reused after that. This changes neither certificate trust nor app privacy permissions.
    run('/usr/bin/security', [
      'import',
      archive,
      '-k',
      keychain,
      '-P',
      password,
      '-T',
      '/usr/bin/codesign',
    ]);
    const identity = new X509Certificate(readFileSync(certificate)).fingerprint.replaceAll(':', '');
    const imported = signingIdentities().find(({ hash }) => hash === identity);
    if (!imported)
      throw new Error('The new development identity could not be found in the keychain.');
    log('Created a local Debug signing certificate in the user keychain; future builds reuse it.');
    return usable(imported);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
