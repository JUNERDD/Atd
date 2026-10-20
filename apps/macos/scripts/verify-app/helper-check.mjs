/**
 * The embedded computer-use driver helper's checks (`Contents/MacOS/atd-computer-driver`, built by
 * the tool target of the same name in project.yml): it is a Mach-O thinned to the app's
 * architecture like the main executable, validly signed, requires no newer macOS than the app's
 * `LSMinimumSystemVersion`, and starts. With its standard input closed, the shell's clean-shutdown
 * signal, it announces itself in one `ready` event and exits cleanly. Starting it asks nothing of
 * the system: it sends no event, reads no window or screen and requests no permission (it only
 * looks capabilities up), so the check also runs on a machine that has granted the app nothing.
 * The frame layout is the driver protocol's (Sources/AIComputerDriverKit, which the shell's
 * DriverClient speaks): a 4-byte big-endian length, then that many bytes of UTF-8 JSON.
 */
import { spawnSync } from 'node:child_process';
import { MACHO_ARCHS } from '../arch.mjs';
import { checkMachO, minimumSystem, sliceArchs } from './macho.mjs';
import { CHILD_ENV } from './pack-layout.mjs';

/** The helper's file name in `Contents/MacOS` (project.yml: the `atd-computer-driver` target). */
export const DRIVER_HELPER = 'atd-computer-driver';
/** Far more than a cold start needs: a hang is a failure, not something to wait out. */
const START_TIMEOUT_MS = 20_000;

/** The first frame in `stdout` as parsed JSON, or null while it is incomplete. */
function firstFrame(stdout) {
  if (stdout.length < 4) return null;
  const length = stdout.readUInt32BE(0);
  if (stdout.length < 4 + length) return null;
  return JSON.parse(stdout.subarray(4, 4 + length).toString('utf8'));
}

/** Starts the helper with its standard input already closed and returns its `ready` payload. */
function start(helper) {
  const run = spawnSync(helper, [], { input: '', env: CHILD_ENV, timeout: START_TIMEOUT_MS });
  if (run.error || run.status !== 0) {
    const how = run.error?.message ?? run.signal ?? `exit ${run.status}`;
    const logs = (run.stderr?.toString('utf8') ?? '').trim();
    throw new Error(`${helper} did not start and exit cleanly on end of input (${how}): ${logs}`);
  }
  let frame;
  try {
    frame = firstFrame(run.stdout);
  } catch (error) {
    throw new Error(`${helper} wrote a first frame that is not JSON: ${error.message}`);
  }
  const ready =
    frame?.kind === 'event' && frame.event?.type === 'ready' ? frame.event.payload : null;
  if (!Number.isInteger(ready?.protocolVersion))
    throw new Error(`${helper} did not open with a ready event: ${JSON.stringify(frame)}`);
  return ready;
}

/**
 * Verifies the helper at `helper` for `arch` (a Node architecture name); `maxMinos` is the app's
 * `LSMinimumSystemVersion`. Throws with the file and rule it found broken.
 */
export async function verifyDriverHelper({ helper, arch, maxMinos }) {
  const machOArch = MACHO_ARCHS[arch];
  const archs = sliceArchs(helper);
  if (archs?.join(' ') !== machOArch)
    throw new Error(
      `${helper} must hold exactly ${machOArch}, as the main executable does, not ${archs?.join(', ') ?? 'unreadable'}.`,
    );
  if ((await checkMachO([helper], { machOArch, maxMinos })) !== 1)
    throw new Error(`${helper} is not a Mach-O executable.`);
  const ready = start(helper);
  process.stdout.write(
    `${helper}: ${machOArch} only, signed, minos ${minimumSystem(helper, machOArch)} <= ${maxMinos}; starts, announces protocol ${ready.protocolVersion} and exits on end of input\n`,
  );
}
