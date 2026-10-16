// Writes the signed Sparkle feeds and the artifact manifest of one release build, then checks
// every enclosure it wrote against the dmg it names. Both architectures ship from the same commit
// and version: `appcast.xml` (arm64, also the GitHub asset 0.4.0–0.7.9 installs read) and
// `appcast-x64.xml` (Intel). Their enclosures name the GitHub release download; the mirror job
// re-points them at its verified copy without touching the signature or length.
//
//   SPARKLE_ED_PRIVATE_KEY=… node apps/macos/scripts/release/feeds.mjs --dir <dist> \
//     --marketing-version <v> --build-version <v> --repo <owner/repo> --commit <sha> \
//     --sign-update <path/to/sign_update> --public-ed-key <label>=<base64> [--public-ed-key …]
//
// <dist> holds Atd-<marketing version>-arm64.dmg and Atd-<marketing version>-x64.dmg; the feeds
// and manifest.json are written beside them. The private key is read from the environment only
// and reaches sign_update on stdin. Every enclosure must pass `sign_update --verify` (whose public
// key is derived from the private key) and an Ed25519 verification with each --public-ed-key (the
// key the installed apps hold), so a secret that no longer matches SUPublicEDKey fails here.
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/** Every installer supports macOS 15.0 or later; Sparkle compares it as a three-part version. */
const MINIMUM_SYSTEM_VERSION = '15.0.0';
/** Sparkle 2.9+ offers an item with this requirement only to Apple silicon. */
const ARM64_REQUIREMENT = 'arm64';
const ARCHES = [
  { arch: 'arm64', feed: 'appcast.xml', hardware: ARM64_REQUIREMENT },
  { arch: 'x64', feed: 'appcast-x64.xml', hardware: null },
];
const MARKETING_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
// Sparkle truncates a version at `-`, so a build version (CFBundleVersion) must not contain one.
const BUILD_VERSION = /^\d+(\.[0-9A-Za-z]+)+$/;
// The DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32-byte raw key follows it.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      'marketing-version': { type: 'string' },
      'build-version': { type: 'string' },
      repo: { type: 'string' },
      commit: { type: 'string' },
      'sign-update': { type: 'string' },
      'public-ed-key': { type: 'string', multiple: true },
    },
    strict: true,
  });
  const missing = ['dir', 'marketing-version', 'build-version', 'repo', 'commit', 'sign-update']
    .filter((name) => !values[name])
    .map((name) => `--${name}`);
  if (missing.length > 0) fail(`Missing ${missing.join(', ')}.`);
  if (!MARKETING_VERSION.test(values['marketing-version'])) {
    fail(`Marketing version '${values['marketing-version']}' is not semver.`);
  }
  if (!BUILD_VERSION.test(values['build-version'])) {
    fail(`Build version '${values['build-version']}' must be dot-separated and contain no '-'.`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(values.repo))
    fail(`Repository '${values.repo}' is not owner/repo.`);
  if (!/^[0-9a-f]{40}$/.test(values.commit)) fail(`Commit '${values.commit}' is not a SHA-1.`);
  const privateKey = process.env.SPARKLE_ED_PRIVATE_KEY;
  if (!privateKey)
    fail('SPARKLE_ED_PRIVATE_KEY is missing; installed apps reject unsigned updates.');
  const publicKeys = (values['public-ed-key'] ?? []).map(parsePublicKey);
  if (publicKeys.length === 0) fail('Pass at least one --public-ed-key <label>=<base64>.');
  return {
    dir: values.dir,
    marketingVersion: values['marketing-version'],
    buildVersion: values['build-version'],
    repo: values.repo,
    commit: values.commit,
    signUpdate: values['sign-update'],
    privateKey,
    publicKeys,
  };
}

/** `<label>=<base64 of the 32-byte raw key>`, wrapped as an SPKI key for crypto.verify. */
function parsePublicKey(option) {
  const separator = option.indexOf('=');
  const label = option.slice(0, separator);
  const raw = Buffer.from(option.slice(separator + 1), 'base64');
  if (separator <= 0 || raw.length !== 32) {
    fail(`--public-ed-key '${label || option}' must be <label>=<base64 of a 32-byte key>.`);
  }
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
  return { label, key };
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
}

function unescapeXml(value) {
  return value.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name],
  );
}

/** Signs the dmg with sign_update and returns its signature and the length it reports. */
function sign(options, dmgPath) {
  const output = execFileSync(options.signUpdate, ['--ed-key-file', '-', dmgPath], {
    input: options.privateKey,
    encoding: 'utf8',
  });
  const signature = /sparkle:edSignature="([^"]+)"/.exec(output)?.[1];
  const length = /length="(\d+)"/.exec(output)?.[1];
  if (!signature || !length) fail(`sign_update printed no signature and length for ${dmgPath}.`);
  return { signature, length: Number(length) };
}

function enclosureUrl(options, dmg) {
  return `https://github.com/${options.repo}/releases/download/v${options.marketingVersion}/${dmg}`;
}

function renderFeed(options, build) {
  const { marketingVersion, buildVersion, repo } = options;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">',
    '  <channel>',
    '    <title>Atd</title>',
    '    <item>',
    `      <title>${escapeXml(marketingVersion)}</title>`,
    `      <pubDate>${new Date().toUTCString()}</pubDate>`,
    `      <sparkle:version>${escapeXml(buildVersion)}</sparkle:version>`,
    `      <sparkle:shortVersionString>${escapeXml(marketingVersion)}</sparkle:shortVersionString>`,
    `      <sparkle:minimumSystemVersion>${MINIMUM_SYSTEM_VERSION}</sparkle:minimumSystemVersion>`,
    ...(build.hardware
      ? [`      <sparkle:hardwareRequirements>${build.hardware}</sparkle:hardwareRequirements>`]
      : []),
    `      <link>https://github.com/${escapeXml(repo)}/releases/tag/v${escapeXml(marketingVersion)}</link>`,
    `      <enclosure url="${escapeXml(enclosureUrl(options, build.dmg))}" length="${build.size}" type="application/octet-stream" sparkle:edSignature="${escapeXml(build.signature)}"/>`,
    '    </item>',
    '  </channel>',
    '</rss>',
    '',
  ];
  return lines.join('\n');
}

/** The text of every `<tag>` element in the feed. */
function elements(feed, tag) {
  return [...feed.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) =>
    unescapeXml(m[1]),
  );
}

/**
 * Re-reads a written feed and checks its single item against the dmg on disk: versions, system
 * and hardware requirements, URL, length and the EdDSA signature (sign_update and each public key).
 */
function checkFeed(options, build) {
  const feedPath = join(options.dir, build.feed);
  const feed = readFileSync(feedPath, 'utf8');
  const problems = [];
  const expectOne = (tag, value) => {
    const found = elements(feed, tag);
    if (found.length !== 1 || found[0] !== value) {
      problems.push(`<${tag}> is ${JSON.stringify(found)}, expected ["${value}"]`);
    }
  };
  expectOne('sparkle:version', options.buildVersion);
  expectOne('sparkle:shortVersionString', options.marketingVersion);
  expectOne('sparkle:minimumSystemVersion', MINIMUM_SYSTEM_VERSION);
  const hardware = elements(feed, 'sparkle:hardwareRequirements');
  if (JSON.stringify(hardware) !== JSON.stringify(build.hardware ? [build.hardware] : [])) {
    problems.push(`<sparkle:hardwareRequirements> is ${JSON.stringify(hardware)}`);
  }
  const enclosures = [...feed.matchAll(/<enclosure\s([^>]*?)\/>/g)];
  if (enclosures.length !== 1) problems.push(`${enclosures.length} enclosures, expected 1`);
  const attributes = Object.fromEntries(
    [...(enclosures[0]?.[1] ?? '').matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [
      m[1],
      unescapeXml(m[2]),
    ]),
  );
  if (attributes.url !== enclosureUrl(options, build.dmg)) {
    problems.push(`enclosure url is ${attributes.url}`);
  }
  const bytes = statSync(build.path).size;
  if (Number(attributes.length) !== bytes) {
    problems.push(`enclosure length is ${attributes.length}, but ${build.dmg} has ${bytes} bytes`);
  }
  const signature = attributes['sparkle:edSignature'] ?? '';
  try {
    execFileSync(options.signUpdate, ['--verify', '--ed-key-file', '-', build.path, signature], {
      input: options.privateKey,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
  } catch {
    problems.push('sign_update --verify rejects the enclosure signature');
  }
  const data = readFileSync(build.path);
  for (const { label, key } of options.publicKeys) {
    if (!verify(null, data, key, Buffer.from(signature, 'base64'))) {
      problems.push(`the ${label} SUPublicEDKey rejects the enclosure signature`);
    }
  }
  if (problems.length > 0) fail(`${build.feed}: ${problems.join('; ')}.`);
  console.log(`${build.feed}: ${build.dmg}, ${bytes} bytes, signature verified.`);
}

const options = readOptions();
const builds = [];
for (const { arch, feed, hardware } of ARCHES) {
  const dmg = `Atd-${options.marketingVersion}-${arch}.dmg`;
  const path = join(options.dir, dmg);
  let size;
  try {
    size = statSync(path).size;
  } catch {
    fail(`${path} is missing.`);
  }
  const { signature, length } = sign(options, path);
  if (length !== size) fail(`sign_update reports ${length} bytes for ${dmg}, which has ${size}.`);
  builds.push({ arch, feed, hardware, dmg, path, size, signature, sha256: await sha256(path) });
}
for (const build of builds)
  writeFileSync(join(options.dir, build.feed), renderFeed(options, build));
for (const build of builds) checkFeed(options, build);

const manifest = {
  marketingVersion: options.marketingVersion,
  buildVersion: options.buildVersion,
  commit: options.commit,
  artifacts: builds.map(({ arch, dmg, sha256: digest, size, feed }) => ({
    arch,
    dmg,
    sha256: digest,
    size,
    feed,
  })),
};
writeFileSync(join(options.dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
