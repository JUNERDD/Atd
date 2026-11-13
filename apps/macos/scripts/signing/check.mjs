#!/usr/bin/env node
/** Read-only release gate, usable on verification runners without the private signing key. */
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, signingConfig } from './config.mjs';
import { verifyDeveloperId, verifyReleaseEntitlements } from './sign-app.mjs';
import { checkUpgradeCompatibility } from './upgrade-compat.mjs';

const [file, notarized, ...extra] = process.argv.slice(2);
if (!file || extra.length || (notarized && notarized !== '--notarized'))
  throw new Error('Usage: check.mjs <Atd.app> [--notarized]');
const config = signingConfig();
if (!config.identity || !config.teamId)
  throw new Error('Provide the expected signing identity and team.');
const app = path.resolve(file);
verifyDeveloperId(app, config);
verifyReleaseEntitlements(app);
checkUpgradeCompatibility(app);
const temporary = mkdtempSync(path.join(tmpdir(), 'atd-certificate-check-'));
try {
  const prefix = path.join(temporary, 'certificate');
  run('codesign', ['-d', `--extract-certificates=${prefix}`, app]);
  const certificate = new X509Certificate(readFileSync(`${prefix}0`));
  if (certificate.fingerprint.replaceAll(':', '') !== config.identity.toUpperCase())
    throw new Error('The app is signed with a different certificate than configured.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
if (notarized) {
  run('xcrun', ['stapler', 'validate', app]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
}
console.log('Release signature and existing-user upgrade checks passed.');
