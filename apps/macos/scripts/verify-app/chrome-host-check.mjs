/**
 * The embedded Atd for Chrome native messaging host's checks (`Contents/MacOS/atd-chrome-host`,
 * built by the tool target of the same name in project.yml), and the Info.plist values it and the
 * shell read: `AtdHostBundleIdentifier` (which locates the shell's socket), `AtdChromeHostName` and
 * `AtdChromeExtensionID` (the flavor the host manifest registers, ChromeChannelIdentity), each
 * valid by Chrome's and the host's rules. The host is a Mach-O thinned to the app's architecture
 * like the main executable, validly signed, requires no newer macOS than the app's
 * `LSMinimumSystemVersion`, and starts.
 *
 * The start needs no running Atd and touches nothing of the person's: the host runs with an empty
 * temporary home (Foundation resolves Application Support from `CFFIXED_USER_HOME`, not `HOME`),
 * where the shell's socket cannot exist. It must then exit promptly with `EX_UNAVAILABLE` (69),
 * write nothing to stdout (Chrome's channel), and write one stderr line naming the socket it looked
 * for under that home, which shows it read its app's Info.plist and bundle id, and leave the home
 * empty. The temporary home sits under /tmp because the socket path must fit a 104-byte unix
 * socket address.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MACHO_ARCHS } from '../arch.mjs';
import { checkThinExecutable } from './macho.mjs';
import { CHILD_ENV } from './pack-layout.mjs';

/** The host's file name in `Contents/MacOS` (project.yml: the `atd-chrome-host` target). */
export const CHROME_HOST = 'atd-chrome-host';
/** sysexits' EX_UNAVAILABLE: no shell listens (Sources/AtdChromeHostCLI/HostMain.swift). */
const EX_UNAVAILABLE = 69;
/** A start that finds no socket returns at once; a hang is a failure, not something to wait out. */
const START_TIMEOUT_MS = 10_000;

/** Chrome's rules for a native messaging host name and an extension ID, and a bundle id. */
const RULES = {
  AtdChromeHostName: (value) => value.length <= 255 && /^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(value),
  AtdChromeExtensionID: (value) => /^[a-p]{32}$/.test(value),
  AtdHostBundleIdentifier: (value) =>
    value.length <= 255 && /^[A-Za-z0-9.-]+$/.test(value) && value !== '.' && value !== '..',
};

/** Throws listing every Info.plist value the host or the shell's manifest cannot use. */
function checkIdentity(infoFile, info) {
  const wrong = Object.entries(RULES)
    .filter(([key, valid]) => typeof info[key] !== 'string' || !valid(info[key]))
    .map(([key]) => `${key} is ${JSON.stringify(info[key])}, which is not valid`);
  if (wrong.length > 0) throw new Error(`${infoFile}:\n${wrong.join('\n')}`);
}

/** Runs the host as Chrome would, with no shell to connect to, and checks how it gives up. */
function start(host, info) {
  const home = mkdtempSync('/tmp/atd-chrome-host-');
  try {
    const run = spawnSync(host, [`chrome-extension://${info.AtdChromeExtensionID}/`], {
      input: '',
      env: { ...CHILD_ENV, HOME: home, CFFIXED_USER_HOME: home },
      timeout: START_TIMEOUT_MS,
    });
    const logs = (run.stderr?.toString('utf8') ?? '').trim();
    if (run.error || run.status !== EX_UNAVAILABLE) {
      const how = run.error?.message ?? run.signal ?? `exit ${run.status}`;
      throw new Error(
        `${host} did not report a missing Atd with exit ${EX_UNAVAILABLE} (${how}): ${logs}`,
      );
    }
    if (run.stdout.length > 0)
      throw new Error(`${host} wrote ${run.stdout.length} bytes to stdout, Chrome's channel.`);
    const socket = path.join(
      path.basename(home),
      'Library/Application Support',
      info.AtdHostBundleIdentifier,
      'chrome/host.sock',
    );
    if (logs.split('\n').length !== 1 || !logs.includes(socket))
      throw new Error(`${host} should log one line naming …/${socket}, not: ${logs}`);
    const left = readdirSync(home);
    if (left.length > 0) throw new Error(`${host} left ${left.join(', ')} in its home.`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Verifies the host at `host` for `arch` (a Node architecture name) against the app's Info.plist
 * (`info`, read from `infoFile`). Throws with the file and rule it found broken.
 */
export async function verifyChromeHost({ host, arch, info, infoFile }) {
  checkIdentity(infoFile, info);
  const machOArch = MACHO_ARCHS[arch];
  const maxMinos = info.LSMinimumSystemVersion;
  const minos = await checkThinExecutable(host, { machOArch, maxMinos });
  start(host, info);
  process.stdout.write(
    `${host}: ${machOArch} only, signed, minos ${minos} <= ${maxMinos}; pairs with ${info.AtdChromeHostName} (${info.AtdChromeExtensionID}); exits ${EX_UNAVAILABLE} when Atd is not running\n`,
  );
}
