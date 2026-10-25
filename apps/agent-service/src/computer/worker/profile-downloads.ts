import { access, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Where a download goes that no call caused (a person's own, on a page no call named): the
 * folder Chrome itself would use for the managed profile, so attaching the worker leaves such a
 * download where it would have been without it. The profile is the one under
 * `<dataDir>/computer/profiles/` whose `DevToolsActivePort` names the worker's browser socket;
 * its `Default/Preferences` may set `download.default_directory`, and without one Chrome uses
 * `~/Downloads`. When the profile cannot be identified the folder is unknown and the caller does
 * not guess one.
 */

const ACTIVE_PORT_FILE = 'DevToolsActivePort';
/** Chrome's own suffixes for a taken name go up to 99 before it gives up. */
const MAX_SUFFIX = 99;

/** The managed profile directory whose browser `socket` is, or undefined. */
async function profileOf(profilesRoot: string, socket: URL): Promise<string | undefined> {
  const entries = await readdir(profilesRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(profilesRoot, entry.name);
    const text = await readFile(path.join(dir, ACTIVE_PORT_FILE), 'utf8').catch(() => '');
    const [port, browserPath] = text.split('\n');
    if (port === socket.port && browserPath === socket.pathname) return dir;
  }
  return undefined;
}

/** `download.default_directory` of the profile's preferences when it names a directory. */
async function preferredDirectory(profile: string): Promise<string | undefined> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(path.join(profile, 'Default', 'Preferences'), 'utf8'),
    );
    const download =
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['download'] : null;
    const dir =
      typeof download === 'object' && download !== null
        ? (download as Record<string, unknown>)['default_directory']
        : undefined;
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return undefined;
    return (await stat(dir)).isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The managed profile's download folder for the browser at `socket`, with the data directory
 * found from the upload root `<dataDir>/resources`; undefined when the profile is not found.
 */
export async function profileDownloadDir(
  uploadRoot: string | undefined,
  socket: string | undefined,
): Promise<string | undefined> {
  if (uploadRoot === undefined || socket === undefined || !path.isAbsolute(uploadRoot))
    return undefined;
  const profilesRoot = path.join(path.dirname(path.resolve(uploadRoot)), 'computer', 'profiles');
  const profile = await profileOf(profilesRoot, new URL(socket));
  if (profile === undefined) return undefined;
  return (await preferredDirectory(profile)) ?? path.join(os.homedir(), 'Downloads');
}

/** `name` in `dir`, or Chrome's `name (n).ext` for the first `n` not taken yet. */
export async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 0; n <= MAX_SUFFIX; n += 1) {
    const candidate = path.join(dir, n === 0 ? name : `${base} (${n})${ext}`);
    const taken = await access(candidate).then(
      () => true,
      () => false,
    );
    if (!taken) return candidate;
  }
  throw new Error('No free file name for the download.');
}
