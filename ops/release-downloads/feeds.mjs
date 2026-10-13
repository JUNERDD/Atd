import assert from 'node:assert/strict';
import { REPO } from './artifacts.mjs';

/**
 * The x64 feed while the latest release has no x64 build (any release before 0.9.0, or after a
 * rollback to one): no items, so an Intel install finds no update instead of a withdrawn one.
 */
export const EMPTY_FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Atd</title>
  </channel>
</rss>
`;

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

/** Sparkle accepts a version as an item element or as an enclosure attribute. */
function declares(feed, name, value) {
  return feed.includes(`<${name}>${value}</${name}>`) || feed.includes(`${name}="${value}"`);
}

/** The values of every `<sparkle:{name}>` element, failing on any other spelling of the key. */
function elementValues(feed, name) {
  const values = [...feed.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((match) =>
    match[1].trim(),
  );
  assert.equal(occurrences(feed, name), values.length * 2, `The feed spells ${name} unexpectedly.`);
  return values;
}

/**
 * Checks one architecture's signed release feed and re-points its enclosure at the verified
 * mirror copy. Sparkle's EdDSA signature covers the DMG's bytes, not its URL, and the mirror holds
 * exactly those bytes, so the release job's signature and length stay valid. The GitHub copy keeps
 * the GitHub URL for installs that still read it.
 *
 * A release with x64 assets must carry the 0.9.0 entry rules: arm64 items require arm64 hardware,
 * and both feeds declare a minimum system. Older single-architecture releases (0.8.x) have
 * neither and are accepted as they are, so a rollback can mirror them.
 *
 * @param {object} input
 * @param {string} input.feed The release's feed for this architecture.
 * @param {import('./artifacts.mjs').Release} input.release
 * @param {import('./artifacts.mjs').Artifact} input.artifact
 * @param {string} input.mirrorUrl The public URL of the verified versioned DMG.
 */
export function mirrorFeed({ feed, release, artifact, mirrorUrl }) {
  const { arch } = artifact;
  const label = `The ${arch} release feed`;
  const source = `url="https://github.com/${REPO}/releases/download/${release.tag}/${artifact.name}"`;
  // One enclosure, and it is this architecture's DMG: a feed naming another build is rejected.
  assert.equal(occurrences(feed, '<enclosure'), 1, `${label} must offer exactly one update.`);
  assert.equal(occurrences(feed, source), 1, `${label} must name its own versioned DMG.`);
  assert(feed.includes(` length="${artifact.size}"`), `${label} names a different DMG size.`);
  assert(
    declares(feed, 'sparkle:shortVersionString', release.version),
    `${label} must declare version ${release.version}.`,
  );
  assert(
    declares(feed, 'sparkle:version', release.buildVersion),
    `${label} must declare build ${release.buildVersion}.`,
  );

  const multiArch = !release.absent.includes('x64');
  const hardware = elementValues(feed, 'sparkle:hardwareRequirements');
  if (arch === 'x64') {
    assert.equal(hardware.length, 0, 'The x64 feed must not require Apple silicon.');
  } else {
    assert(
      hardware.every((value) => value === 'arm64'),
      'The arm64 feed may only require arm64 hardware.',
    );
    assert(!multiArch || hardware.length > 0, 'The arm64 feed must require arm64 hardware.');
  }
  const minimums = elementValues(feed, 'sparkle:minimumSystemVersion');
  assert(!multiArch || minimums.length > 0, `${label} must declare a minimum macOS version.`);
  for (const value of minimums) {
    assert(/^\d+(\.\d+){0,2}$/.test(value), `${label} has an invalid minimum macOS version.`);
    // An x86_64 Sparkle treats a minimum of 27 or later as an Apple-silicon-only item.
    assert(arch !== 'x64' || Number(value.split('.')[0]) < 27, 'The x64 feed requires macOS 27.');
  }
  return feed.replace(source, `url="${mirrorUrl}"`);
}
