// component-handoff.sh checks the producer's receipt before extraction and the
// unpacked content before installation. These checks never execute a staged binary.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { archiveName, LOCK_FILE, releaseUrls } from '../addons/layout.mjs';
import { checkBuildLock } from '../addons/schema.mjs';
import { MACHO_ARCHS } from '../arch.mjs';

const [action, kind, directory, exact] = process.argv.slice(2);
const {
  RELEASE_ARCH: arch,
  RELEASE_MACHINE: machine,
  VERSION: version,
  BUILD_VERSION: buildVersion,
  COMPONENT_KEY: componentKey,
  GITHUB_SHA: checkoutSha,
  SOURCE_SHA: sourceSha,
} = process.env;
assert.ok(kind === 'native' || kind === 'service', 'unknown component');
assert.ok(Object.hasOwn(MACHO_ARCHS, arch) && MACHO_ARCHS[arch] === machine, 'wrong architecture');
assert.match(version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
assert.match(buildVersion, /^\d+(\.[0-9A-Za-z]+)+$/);
assert.match(componentKey, /^[0-9a-f]{64}$/);
const commit = /^[0-9a-f]{40}$/;
assert.match(checkoutSha, commit);
const child = (...parts) => path.join(directory, ...parts);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const run = (cmd, ...args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

async function digest(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

async function receipt() {
  const file = child('receipt.json');
  const payload = child('component.tar.gz');
  assert.ok(lstatSync(payload).isFile(), 'expected a regular component archive');
  const metadata = { schemaVersion: 1, kind, arch, version, buildVersion, componentKey };
  if (action === 'record') {
    const record = { ...metadata, buildSha: checkoutSha, sha256: await digest(payload) };
    writeFileSync(file, JSON.stringify(record) + '\n', { flag: 'wx' });
    return;
  }
  assert.ok(lstatSync(file).isFile(), 'expected a regular component receipt');
  const { buildSha, sha256, ...recorded } = readJson(file);
  assert.deepEqual(recorded, metadata, 'wrong component, version, architecture or key');
  assert.match(buildSha, commit);
  if (sourceSha) assert.equal(buildSha, sourceSha, 'unexpected component build SHA');
  assert.equal(await digest(payload), sha256, 'component archive differs from receipt');
}

function checkTree(root) {
  assert.ok(lstatSync(root).isDirectory(), `expected a directory at ${root}`);
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory() || entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    assert.ok(entry.isSymbolicLink(), `unexpected special file ${file}`);
    assert.ok(!path.isAbsolute(readlinkSync(file)), `absolute symlink at ${file}`);
    const target = realpathSync.native(file);
    assert.ok(
      target === root || target.startsWith(root + '/'),
      `symlink leaves component at ${file}`,
    );
  }
}

function checkNative() {
  const app = child('Atd.app', 'Contents');
  for (const payload of ['renderer', 'agent-service', 'node']) {
    const dir = path.join(app, 'Resources', payload);
    assert.ok(!lstatSync(dir, { throwIfNoEntry: false }), `native shell already contains ${dir}`);
  }
  assert.equal(run('lipo', '-archs', path.join(app, 'MacOS', 'Atd')), machine);
  const plist = path.join(app, 'Info.plist');
  assert.equal(run('plutil', '-extract', 'CFBundleShortVersionString', 'raw', plist), version);
  assert.equal(run('plutil', '-extract', 'CFBundleVersion', 'raw', plist), buildVersion);
  run('codesign', '--verify', '--deep', '--strict', child('Atd.app'));
}

async function checkService() {
  for (const name of ['dist/cli.js', 'build-info.json'])
    assert.ok(lstatSync(child('t7-agent-service-pack', name)).isFile(), `invalid service ${name}`);
  assert.equal(run('lipo', '-archs', child('t7-node', 'bin', 'node')), machine);
  const lockBytes = readFileSync(child('addons-release', LOCK_FILE));
  assert.ok(
    lockBytes.equals(readFileSync(child('t7-agent-service-pack', LOCK_FILE))),
    'service and add-on locks differ',
  );
  const lock = JSON.parse(lockBytes);
  checkBuildLock(lock, arch, LOCK_FILE);
  const expected = [LOCK_FILE];
  for (const artifact of lock.addons) {
    const name = archiveName(artifact);
    assert.equal(path.basename(name), name, 'invalid add-on archive name');
    assert.deepEqual(artifact.urls, releaseUrls(artifact, version), 'wrong release URLs in lock');
    const file = child('addons-release', name);
    const stat = lstatSync(file);
    assert.ok(stat.isFile() && stat.size === artifact.size, `invalid add-on archive ${name}`);
    assert.equal(await digest(file), artifact.sha256, `add-on archive differs from lock: ${name}`);
    expected.push(name);
  }
  assert.deepEqual(
    readdirSync(child('addons-release')).sort(),
    expected.sort(),
    'unexpected add-on files',
  );
}

if (action === 'tree') {
  const roots =
    kind === 'native' ? ['Atd.app'] : ['t7-agent-service-pack', 't7-node', 'addons-release'];
  if (exact)
    assert.deepEqual(readdirSync(directory).sort(), [...roots].sort(), 'unexpected archive roots');
  for (const name of roots) checkTree(child(name));
  if (kind === 'native') checkNative();
  else await checkService();
} else if (action === 'record' || action === 'receipt') {
  await receipt();
} else {
  throw new Error('unknown component check');
}
