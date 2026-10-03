import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FolderRegisterFailureReason } from '@atd/agent-contracts';
import { inside } from '../service-fs.js';

/** A directory a task may be granted, by its realpath. */
export interface CheckedFolder {
  ok: true;
  real: string;
}

/** Why a path cannot be granted, with an English message naming only its basename. */
export interface RefusedFolder {
  ok: false;
  reason: FolderRegisterFailureReason;
  message: string;
}

/**
 * Checks that `requested` (absolute) is a directory a task may read: it resolves through every
 * link to a readable directory that is neither the disk root, the user's home directory or a folder
 * that holds it, nor the service data dir or anything inside it. The realpath it answers is what a grant stores
 * and what the read boundary compares against, so a link inside a granted folder that leads
 * elsewhere never counts as inside it.
 */
export async function checkFolder(
  requested: string,
  dataDir: string,
): Promise<CheckedFolder | RefusedFolder> {
  const name = path.basename(requested) || requested;
  let real: string;
  try {
    real = await realpath(requested);
    if (!(await stat(real)).isDirectory())
      return refused('notDirectory', `"${name}" is not a folder.`);
  } catch {
    return refused('unreadable', `"${name}" could not be read.`);
  }
  if (path.parse(real).root === real)
    return refused('forbidden', 'The disk root cannot be made readable to tasks.');
  const folded = foldCase(real);
  const home = foldCase(await realOrSelf(homedir()));
  if (folded === home)
    return refused(
      'forbidden',
      `Your home folder "${name}" cannot be made readable to tasks; choose a folder inside it.`,
    );
  // A folder that holds the home directory reaches everything in it, which is what the check above
  // keeps out.
  if (inside(folded, home))
    return refused(
      'forbidden',
      `"${name}" holds your home folder and cannot be made readable to tasks; choose a folder inside it.`,
    );
  if (inside(foldCase(await realOrSelf(dataDir)), folded))
    return refused(
      'forbidden',
      `"${name}" holds the app's own data and cannot be made readable to tasks.`,
    );
  return { ok: true, real };
}

function refused(reason: FolderRegisterFailureReason, message: string): RefusedFolder {
  return { ok: false, reason, message };
}

async function realOrSelf(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}

/** macOS and Windows volumes are usually case-insensitive: compare those paths folded. */
function foldCase(value: string): string {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? value.toLowerCase()
    : value;
}
