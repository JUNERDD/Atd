import { cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadToolchain } from '@atd/app-kit/node';

/** Every file under `dir`, relative and with `/` separators, sorted. */
async function files(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await files(path.join(dir, entry.name), relative)));
    else if (entry.isFile()) out.push(relative);
  }
  return out.sort();
}

/**
 * `app.scaffold`: copies the app-kit template (the working Notes starter) into `target` when that
 * folder is missing or empty; an existing app is never overwritten. The template comes from the
 * installed `@atd/app-kit` package, so it is the same in the repository and the Release service
 * pack. Answers whether it copied and the files it created, relative to `target`.
 */
export async function scaffoldApp(target: string): Promise<{ created: boolean; files: string[] }> {
  const existing = await readdir(target).catch(() => null);
  if (existing && existing.length > 0) return { created: false, files: [] };
  const template = path.join(loadToolchain().root, 'template');
  await cp(template, target, { recursive: true, errorOnExist: true, force: false });
  return { created: true, files: await files(target) };
}
