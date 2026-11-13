#!/usr/bin/env node
/** User-run setup: passwords are entered in the terminal, never in source or shell history. */
import { X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { configFile, notaryArgs, run, signingConfig, validateIdentity } from './config.mjs';

async function password(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run setup in your own terminal to enter passwords.');
  process.stdout.write(prompt);
  const output = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const value = await input.question('');
    process.stdout.write('\n');
    if (!value) throw new Error('A non-empty password is required.');
    return value;
  } finally {
    input.close();
  }
}

const { values } = parseArgs({
  options: {
    identity: { type: 'string' },
    'team-id': { type: 'string' },
    keychain: { type: 'string' },
    'apple-id': { type: 'string' },
    profile: { type: 'string' },
    credentials: { type: 'boolean', default: false },
    github: { type: 'string' },
    p12: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});
const previous = signingConfig();
const config = validateIdentity({
  ...previous,
  identity: values.identity || previous.identity,
  teamId: values['team-id'] || previous.teamId,
  keychain: values.keychain ? path.resolve(values.keychain) : previous.keychain,
  notaryProfile: values.profile || previous.notaryProfile || 'Atd-notary',
  notaryKeychain: values.keychain
    ? path.resolve(values.keychain)
    : previous.notaryKeychain || previous.keychain,
});
if (values.check) {
  run('xcrun', ['notarytool', 'history', ...notaryArgs(config), '--output-format', 'json']);
  console.log('Developer ID identity and Apple notarization credentials verified.');
  process.exit(0);
}
if (values.github && (!values.credentials || !values.p12))
  throw new Error('--github requires --credentials and --p12.');
if (values.github && !/^[\w.-]+\/[\w.-]+$/.test(values.github))
  throw new Error('--github must be OWNER/REPOSITORY.');
let archive;
let archivePassword;
if (values.github) {
  run('gh', ['repo', 'view', values.github, '--json', 'nameWithOwner']);
  archive = readFileSync(path.resolve(values.p12));
  archivePassword = await password('Password for the encrypted .p12 backup: ');
  const certificates = run(
    '/usr/bin/openssl',
    ['pkcs12', '-in', path.resolve(values.p12), '-nokeys', '-passin', 'stdin'],
    { input: `${archivePassword}\n` },
  );
  const pem =
    certificates.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (
    !pem.some(
      (value) => new X509Certificate(value).fingerprint.replaceAll(':', '') === config.identity,
    )
  )
    throw new Error('The .p12 does not contain the configured Developer ID certificate.');
}
if (values.credentials) {
  if (!values['apple-id']) throw new Error('--credentials requires --apple-id.');
  const appPassword = await password(
    'Apple app-specific password (not your Apple Account login password): ',
  );
  run('xcrun', [
    'notarytool',
    'store-credentials',
    config.notaryProfile,
    '--apple-id',
    values['apple-id'],
    '--team-id',
    config.teamId,
    '--password',
    appPassword,
    ...(config.notaryKeychain ? ['--keychain', config.notaryKeychain] : []),
    '--validate',
  ]);
  if (values.github) {
    console.log(
      `Storing signing and notarization credentials in GitHub Actions for ${values.github}.`,
    );
    for (const [name, value] of Object.entries({
      DEVELOPER_ID_P12: archive.toString('base64'),
      DEVELOPER_ID_P12_PASSWORD: archivePassword,
      NOTARY_APPLE_ID: values['apple-id'],
      NOTARY_APP_PASSWORD: appPassword,
    })) {
      run('gh', ['secret', 'set', name, '--repo', values.github], { input: value });
      console.log(`Configured GitHub secret ${name}.`);
    }
    for (const [name, value] of Object.entries({
      DEVELOPER_ID_SHA1: config.identity,
      APPLE_TEAM_ID: config.teamId,
    }))
      run('gh', ['variable', 'set', name, '--repo', values.github], { input: value });
  }
}
mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
writeFileSync(configFile, `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`, {
  mode: 0o600,
});
console.log(
  'Saved signing configuration shared by all local checkouts. No passwords were written to it.',
);
