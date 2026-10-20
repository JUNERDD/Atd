import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * The macOS attributes a browser download carries: Gatekeeper's quarantine, which makes the system
 * check a downloaded app or script before it first runs, and the URLs it came from. The browser
 * worker stamps them on every file it saves (worker/quarantine.ts); importing a download into the
 * resource store copies its bytes, so the service carries the attributes over to the task file,
 * which a person can open from Atd. Elsewhere (Linux CI) there is nothing to carry.
 */
const ATTRIBUTES = ['com.apple.quarantine', 'com.apple.metadata:kMDItemWhereFroms'] as const;
const QUARANTINE = 'com.apple.quarantine';
const XATTR = '/usr/bin/xattr';

const run = promisify(execFile);

/** Attribute name → its raw value in hex, as `xattr -px` prints it. */
export type DownloadMarks = ReadonlyMap<string, string>;

/**
 * The marks of a staged download, or null on macOS when it has no quarantine: the worker never
 * leaves such a file, so one without it is not imported rather than handed on unchecked.
 */
export async function readDownloadMarks(file: string): Promise<DownloadMarks | null> {
  const marks = new Map<string, string>();
  if (process.platform !== 'darwin') return marks;
  for (const name of ATTRIBUTES) {
    try {
      const { stdout } = await run(XATTR, ['-px', name, file]);
      marks.set(name, stdout.replace(/\s+/g, ''));
    } catch {
      if (name === QUARANTINE) return null;
    }
  }
  return marks;
}

/** Writes `marks` onto `file`; throws when any of them cannot be written. */
export async function writeDownloadMarks(file: string, marks: DownloadMarks): Promise<void> {
  for (const [name, hex] of marks) await run(XATTR, ['-wx', name, hex, file]);
}
