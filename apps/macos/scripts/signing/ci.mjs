/** Ephemeral CI credentials. Never reads or overwrites the legacy self-signed release secrets. */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run, validateIdentity } from './config.mjs';

if (!process.env.RUNNER_TEMP || !process.env.GITHUB_ENV)
  throw new Error('This entry is for GitHub Actions only.');
const keychain = path.join(process.env.RUNNER_TEMP, 'atd-developer-id.keychain-db');
const searchFile = path.join(process.env.RUNNER_TEMP, 'atd-keychain-search.json');
if (process.argv.includes('--cleanup')) {
  if (existsSync(searchFile)) {
    run('security', [
      'list-keychains',
      '-d',
      'user',
      '-s',
      ...JSON.parse(readFileSync(searchFile, 'utf8')),
    ]);
    rmSync(searchFile);
  }
  if (existsSync(keychain)) run('security', ['delete-keychain', keychain]);
  process.exit(0);
}
const required = [
  'DEVELOPER_ID_P12',
  'DEVELOPER_ID_P12_PASSWORD',
  'DEVELOPER_ID_SHA1',
  'APPLE_TEAM_ID',
  'NOTARY_APPLE_ID',
  'NOTARY_APP_PASSWORD',
];
for (const name of required)
  if (!process.env[name]?.trim())
    throw new Error(`Missing ${name}; refusing an unsigned or unnotarized release.`);
const original = [...run('security', ['list-keychains', '-d', 'user']).matchAll(/"([^"]+)"/g)].map(
  (value) => value[1],
);
writeFileSync(searchFile, JSON.stringify(original), { mode: 0o600 });
const password = randomBytes(32).toString('hex');
run('security', ['create-keychain', '-p', password, keychain]);
run('security', ['set-keychain-settings', '-lut', '21600', keychain]);
run('security', ['unlock-keychain', '-p', password, keychain]);
const archive = path.join(process.env.RUNNER_TEMP, 'atd-developer-id.p12');
try {
  writeFileSync(archive, Buffer.from(process.env.DEVELOPER_ID_P12, 'base64'), { mode: 0o600 });
  run('security', [
    'import',
    archive,
    '-k',
    keychain,
    '-P',
    process.env.DEVELOPER_ID_P12_PASSWORD,
    '-T',
    '/usr/bin/codesign',
  ]);
} finally {
  rmSync(archive, { force: true });
}
run('security', [
  'set-key-partition-list',
  '-S',
  'apple-tool:,apple:,codesign:',
  '-s',
  '-k',
  password,
  keychain,
]);
run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...original]);
validateIdentity({
  identity: process.env.DEVELOPER_ID_SHA1,
  teamId: process.env.APPLE_TEAM_ID,
  keychain,
});
run('xcrun', [
  'notarytool',
  'store-credentials',
  'Atd-release',
  '--keychain',
  keychain,
  '--apple-id',
  process.env.NOTARY_APPLE_ID,
  '--team-id',
  process.env.APPLE_TEAM_ID,
  '--password',
  process.env.NOTARY_APP_PASSWORD,
  '--validate',
]);
for (const [name, value] of Object.entries({
  AI_CODE_SIGN_IDENTITY: process.env.DEVELOPER_ID_SHA1,
  AI_DEVELOPMENT_TEAM: process.env.APPLE_TEAM_ID,
  AI_SIGNING_KEYCHAIN: keychain,
  AI_NOTARY_PROFILE: 'Atd-release',
  AI_NOTARY_KEYCHAIN: keychain,
}))
  appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
console.log('Developer ID and notarization credentials are ready in the temporary CI keychain.');
