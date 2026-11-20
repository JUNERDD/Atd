#!/usr/bin/env node
/**
 * Picks the iPhone simulator that tests and screenshots run on: `ATD_SIMULATOR` (a device name or
 * UDID) when set, otherwise an available iPhone on the newest installed iOS runtime, preferring an
 * iPhone Pro. Run directly, it prints the chosen device's UDID.
 *
 *   node scripts/simulator.mjs
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** `com.apple.CoreSimulator.SimRuntime.iOS-26-3` → [26, 3]. */
function runtimeVersion(runtime) {
  const match = /\.SimRuntime\.iOS-([\d-]+)$/.exec(runtime);
  return match ? match[1].split('-').map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

const preference = (name) =>
  /^iPhone \d+ Pro$/.test(name) ? 0 : /^iPhone \d+$/.test(name) ? 1 : 2;

/** The simulator to use: `{ name, udid, state, version }`. Throws when none is installed. */
export function pickSimulator(requested = process.env.ATD_SIMULATOR) {
  const listing = JSON.parse(
    execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
      encoding: 'utf8',
    }),
  );
  const iPhones = Object.entries(listing.devices).flatMap(([runtime, devices]) => {
    const version = runtimeVersion(runtime);
    if (!version) return [];
    return devices
      .filter((device) => device.isAvailable && device.name.startsWith('iPhone'))
      .map((device) => ({ name: device.name, udid: device.udid, state: device.state, version }));
  });
  if (requested) {
    const match = iPhones.find((d) => d.udid === requested || d.name === requested);
    if (!match) throw new Error(`ATD_SIMULATOR=${requested} names no available iPhone simulator.`);
    return match;
  }
  iPhones.sort(
    (a, b) => compareVersions(b.version, a.version) || preference(a.name) - preference(b.name),
  );
  if (!iPhones.length) throw new Error('No iPhone simulator is installed; add one in Xcode.');
  return iPhones[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${pickSimulator().udid}\n`);
  } catch (error) {
    process.stderr.write(`simulator: ${error.message}\n`);
    process.exit(1);
  }
}
