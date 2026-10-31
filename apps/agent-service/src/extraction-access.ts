import path from 'node:path';
import { entryAt, extractionLayout, extractionSource } from './file-loader/extraction-paths.js';
import { inside, realAncestorPath } from './service-fs.js';
import { servicePaths } from './storage.js';

/**
 * Whether a reader may open a source file, by its real path, without a confirmation: answered as
 * the reader answers for a read of that file itself (the parent's file and search tools, a
 * subagent child's tools), from its own material only and never through another entry.
 */
export type SourceCheck = (source: string) => Promise<boolean>;

/**
 * The directory of the extraction entry (file-loader/extraction-paths.ts) that the real path `real`
 * lies in, when its reader may open it without a confirmation: the entry's recorded source still is
 * the version the entry was made of, and `mayOpen` admits that source. Access mirrors the source,
 * so a record grants nothing by itself. Null for every other path: the store root, `entries/`, the
 * source records and staging directories, an entry whose source changed or is gone, and one whose
 * source the reader would have to ask for. The directory is a real path; the caller's confinement
 * still checks every path a call touches against it, so a link in the entry that leads out is not
 * followed.
 */
export async function entitledEntry(
  dataDir: string,
  real: string,
  mayOpen: SourceCheck,
): Promise<string | null> {
  const layout = extractionLayout(servicePaths(dataDir).extractionsDir);
  const entry = await entryAt(layout, real);
  // `entryAt` matches case-insensitively, as the volume usually does; a real path is in the case
  // stored on disk, and on a case-sensitive volume another case names another directory.
  if (!entry || !inside(entry.dir, real)) return null;
  const source = await extractionSource(layout, real);
  return source !== null && (await mayOpen(source)) ? entry.dir : null;
}

/**
 * Whether the real path `real` lies in the task folder `cwd`, the `inside` scope that no tier asks
 * a read for. Compared real path to real path, as `confined` (service-fs.ts) decides `inside`.
 */
export async function inTaskFolder(cwd: string, real: string): Promise<boolean> {
  return inside(await realAncestorPath(path.resolve(cwd)), await realAncestorPath(real));
}
