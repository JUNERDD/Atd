#!/usr/bin/env node
/**
 * Restores the release signing secrets (`RELEASE_SIGNING_P12`, `RELEASE_SIGNING_P12_PASSWORD`)
 * that `.github/workflows/release.yml` signs with, from the certificate's private key.
 *
 * The certificate is public and lives beside this script's package (`release-certificate.pem`);
 * only its private key is kept outside the repository, as a note small enough for a password
 * manager. The script waits for that key on the clipboard, so the command itself can be copied
 * and pasted first, then clears the clipboard. It checks that the certificate is the one the
 * workflow pins and that the key belongs to it, packs both into a PKCS#12 under a new random
 * password, and sets the two secrets with `gh` for the repository of the current checkout.
 * Nothing is written outside a private temporary directory, which is removed at the end.
 *
 * Usage: node apps/macos/scripts/restore-release-signing.mjs [--dry-run]
 *   --dry-run  everything except setting the secrets.
 */
import { execFileSync } from 'node:child_process';
import { X509Certificate, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

const dryRun = process.argv.includes('--dry-run');
const repo = path.resolve(import.meta.dirname, '../../..');
const certificateFile = path.join(repo, 'apps/macos/release-certificate.pem');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const certificate = new X509Certificate(readFileSync(certificateFile));
const workflow = readFileSync(path.join(repo, '.github/workflows/release.yml'), 'utf8');
const pinned = /RELEASE_SIGNING_SHA1: ([0-9A-F]{40})/.exec(workflow)?.[1];
if (certificate.fingerprint.replaceAll(':', '') !== pinned) {
  fail('release-certificate.pem is not the certificate release.yml pins (RELEASE_SIGNING_SHA1).');
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
await prompt.question(
  'Copy the private key from the "Atd Release Signing" entry in Passwords, then press Return. ',
);
prompt.close();
const key = execFileSync('pbpaste', { encoding: 'utf8' });
execFileSync('pbcopy', { input: '' });

let publicKey;
try {
  publicKey = createPublicKey(createPrivateKey(key));
} catch {
  fail('The clipboard does not hold a private key.');
}
const der = (value) => value.export({ type: 'spki', format: 'der' });
if (!der(publicKey).equals(der(certificate.publicKey))) {
  fail('The key does not belong to release-certificate.pem.');
}

const directory = mkdtempSync(path.join(tmpdir(), 'atd-release-signing-'));
try {
  const keyFile = path.join(directory, 'key.pem');
  const p12File = path.join(directory, 'signing.p12');
  const password = randomBytes(24).toString('hex');
  writeFileSync(keyFile, key, { mode: 0o600 });
  // The system's LibreSSL writes the PKCS#12 encryption `security import` reads on the runner.
  execFileSync(
    '/usr/bin/openssl',
    [
      'pkcs12',
      '-export',
      '-inkey',
      keyFile,
      '-in',
      certificateFile,
      '-name',
      'Atd Release Signing',
      '-out',
      p12File,
      '-passout',
      'env:P12_PASSWORD',
    ],
    { env: { ...process.env, P12_PASSWORD: password }, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const p12 = readFileSync(p12File).toString('base64');
  if (dryRun) {
    console.log('The key matches the certificate; --dry-run left the secrets as they were.');
  } else {
    for (const [name, value] of [
      ['RELEASE_SIGNING_P12', p12],
      ['RELEASE_SIGNING_P12_PASSWORD', password],
    ]) {
      execFileSync('gh', ['secret', 'set', name], { cwd: repo, input: value, stdio: 'pipe' });
      console.log(`Set ${name}.`);
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
