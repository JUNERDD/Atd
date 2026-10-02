import * as fs from 'node:fs';
import { realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import type { FetchLimits } from './installer.js';
import { copyTree, droppedLinkWarning } from './fetch-local.js';
import type { FetchedSource } from './fetch.js';

/** Input of `PluginInstallerOptions.gitClone`. */
export interface GitCloneInput {
  url: string;
  /** Branch, tag or full commit id; the remote default branch when absent. */
  ref?: string;
  /** Destination working tree; it does not exist yet. */
  dir: string;
}
/** Clones `url` into `dir` checked out at `ref` and reports the checked-out commit id. */
export type GitClone = (input: GitCloneInput) => Promise<{ commit: string }>;

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * isomorphic-git clone over HTTPS. Branches and tags are fetched shallowly (depth 1, single
 * branch). A full commit id cannot be requested shallowly, so it clones the history and checks
 * that commit out.
 */
export const isomorphicGitClone: GitClone = async ({ url, ref, dir }) => {
  if (ref !== undefined && COMMIT.test(ref)) {
    await git.clone({ fs, http, dir, url, noCheckout: true, noTags: true });
    await git.checkout({ fs, dir, ref, force: true });
  } else {
    await git.clone({ fs, http, dir, url, ref, singleBranch: true, depth: 1, noTags: true });
  }
  return { commit: await git.resolveRef({ fs, dir, ref: 'HEAD' }) };
};

/** `subdir` as a clean relative POSIX path ('' for the repository root). */
export function normalizeSubdir(subdir: string | undefined): string {
  if (subdir === undefined) return '';
  const normalized = path.posix.normalize(subdir.replaceAll('\\', '/')).replace(/^\/+|\/+$/g, '');
  if (normalized === '.' || normalized === '') return '';
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`The git subdirectory "${subdir}" leaves the repository.`);
  }
  return normalized;
}

function repositoryName(url: string): string {
  const last = new URL(url).pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  return last.replace(/\.git$/i, '') || 'plugin';
}

/**
 * Clones into `workDir`, then copies the selected plugin root into `tree` without `.git`. The
 * recorded commit pins exactly what was published.
 */
export async function fetchGit(
  spec: { url: string; ref?: string; subdir?: string },
  paths: { tree: string; workDir: string },
  limits: FetchLimits,
  clone: GitClone,
): Promise<FetchedSource> {
  let parsed: URL;
  try {
    parsed = new URL(spec.url);
  } catch {
    throw new Error(`"${spec.url}" is not a valid git URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Only https:// git URLs are supported (got "${spec.url}").`);
  }
  const subdir = normalizeSubdir(spec.subdir);
  const cloneDir = path.join(paths.workDir, 'clone');
  try {
    const { commit } = await clone({
      url: spec.url,
      ...(spec.ref === undefined ? {} : { ref: spec.ref }),
      dir: cloneDir,
    });
    if (!COMMIT.test(commit)) throw new Error(`git returned an invalid commit id "${commit}".`);
    const realClone = await realpath(cloneDir);
    let pluginRoot: string;
    try {
      pluginRoot = await realpath(path.join(realClone, ...subdir.split('/').filter(Boolean)));
    } catch {
      throw new Error(`The repository has no folder "${subdir}".`);
    }
    if (pluginRoot !== realClone && !pluginRoot.startsWith(realClone + path.sep)) {
      throw new Error(`The git subdirectory "${subdir}" resolves outside the repository.`);
    }
    const dropped = await copyTree(pluginRoot, paths.tree, limits);
    return {
      source: {
        kind: 'git',
        url: spec.url,
        ...(spec.ref === undefined ? {} : { ref: spec.ref }),
        ...(subdir === '' ? {} : { subdir }),
      },
      resolved: { commit },
      fallbackName: subdir === '' ? repositoryName(spec.url) : path.posix.basename(subdir),
      warnings: dropped.map(droppedLinkWarning),
    };
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }
}
