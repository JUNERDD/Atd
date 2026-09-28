import type { PluginSourceSpec, ResolvedSource } from '../model/manifest.js';
import type { FetchLimits } from './installer.js';
import { fetchGit, normalizeSubdir, type GitClone } from './fetch-git.js';
import { fetchLocal } from './fetch-local.js';
import { fetchNpm } from './fetch-npm.js';
import { parseNpmSpec } from './npm-spec.js';

/** What a fetcher left in its staging tree. */
export interface FetchedSource {
  /** The spec to record: local paths become real absolute paths, git subdirs are normalized. */
  source: PluginSourceSpec;
  resolved: ResolvedSource;
  /** Name for bundles without a manifest name: folder, repository or package name. */
  fallbackName: string;
  /** Integrity weaknesses worth logging (for example an npm SHA-1-only checksum). */
  warnings?: string[];
}

export interface FetchContext {
  limits: FetchLimits;
  fetch: typeof globalThis.fetch;
  npmRegistry: string;
  gitClone: GitClone;
}

/** Fetches `spec` into `tree` (created by the fetcher), using `workDir` for temporary files. */
export function fetchSource(
  spec: PluginSourceSpec,
  paths: { tree: string; workDir: string },
  context: FetchContext,
): Promise<FetchedSource> {
  switch (spec.kind) {
    case 'local':
      return fetchLocal(spec.path, paths.tree, context.limits);
    case 'git':
      return fetchGit(spec, paths, context.limits, context.gitClone);
    case 'npm':
      return fetchNpm(spec.spec, paths, {
        registry: context.npmRegistry,
        fetch: context.fetch,
        limits: context.limits,
      });
  }
}

/**
 * What must stay the same for an install to update an existing plugin: the local folder, the
 * npm package name, or the git repository and subdirectory. Refs and versions may change.
 */
export function sourceIdentity(source: PluginSourceSpec): string {
  switch (source.kind) {
    case 'local':
      return `local:${source.path}`;
    case 'npm':
      return `npm:${parseNpmSpec(source.spec).name}`;
    case 'git':
      return `git:${source.url}#${normalizeSubdir(source.subdir)}`;
  }
}
