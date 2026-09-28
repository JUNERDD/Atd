import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import {
  NormalizedPluginSchema,
  PluginSourceSpecSchema,
  ResolvedSourceSchema,
} from '../model/manifest.js';
import type { InstallPreview } from '../model/records.js';
import { readJsonFile, writeJsonFile } from './store.js';

/** `staging/<previewId>/preview.json`: an `InstallPreview` as stored between preview and install. */
const PreviewFileSchema = Type.Object({
  previewId: Type.String(),
  expiresAt: Type.String(),
  source: PluginSourceSpecSchema,
  resolved: ResolvedSourceSchema,
  revision: Type.String({ pattern: '^[0-9a-f]{16,64}$' }),
  plugin: NormalizedPluginSchema,
  existing: Type.Optional(Type.Object({ revision: Type.String(), source: PluginSourceSpecSchema })),
  review: Type.Object({
    stdio: Type.Array(
      Type.Object({ name: Type.String(), command: Type.String(), args: Type.Array(Type.String()) }),
    ),
    urls: Type.Array(Type.Object({ name: Type.String(), url: Type.String() })),
    scripts: Type.Array(Type.String()),
  }),
});
type PreviewFile = Static<typeof PreviewFileSchema>;

/**
 * One staging generation: `tree/` is the fetched plugin root, `work/` holds fetch temporaries,
 * and `preview.json` exists once the preview is complete.
 */
export function stagingPaths(stagingRoot: string, previewId: string) {
  const dir = path.join(stagingRoot, previewId);
  return {
    dir,
    tree: path.join(dir, 'tree'),
    work: path.join(dir, 'work'),
    metadata: path.join(dir, 'preview.json'),
  };
}

export async function writePreview(stagingRoot: string, preview: InstallPreview): Promise<void> {
  await writeJsonFile(stagingPaths(stagingRoot, preview.previewId).metadata, preview);
}

/** The stored preview, or null when no completed preview has this id. */
export async function readPreview(
  stagingRoot: string,
  previewId: string,
): Promise<InstallPreview | null> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(previewId)) return null;
  const file = stagingPaths(stagingRoot, previewId).metadata;
  const preview: PreviewFile | null = await readJsonFile(file, PreviewFileSchema, () => null);
  return preview;
}

/**
 * Deletes staging generations whose preview expired, plus leftovers without a readable
 * preview (an interrupted fetch). Generations in `active` are still being fetched.
 */
export async function removeExpiredStaging(
  stagingRoot: string,
  now: Date,
  active: ReadonlySet<string>,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(stagingRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const name of names) {
    if (active.has(name)) continue;
    let expired = true;
    try {
      const preview = await readPreview(stagingRoot, name);
      expired = preview === null || Date.parse(preview.expiresAt) <= now.getTime();
    } catch {
      // An unreadable preview is disposable staging, unlike the registry and state files.
    }
    if (expired) await rm(path.join(stagingRoot, name), { recursive: true, force: true });
  }
}
