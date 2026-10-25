/**
 * What the computer-use add-ons hold and where their archives are published. The packer
 * (addons/pack.mjs), the service pack and verify-app all read these names, so an archive, its
 * lock entry and the checks cannot drift apart. The shapes themselves are the contract's
 * (`packages/agent-contracts/src/addons.ts`); addons/schema.mjs checks them.
 */
import path from 'node:path';

/** `COMPUTER_BROWSER_ADDON`: the Playwright (CDP) worker the shell runs with the app's own Node. */
export const COMPUTER_BROWSER = 'computer-browser';
/** Every add-on a build packs, in lock order. */
export const ADDON_IDS = Object.freeze([COMPUTER_BROWSER]);

/** The manifest at every archive's root; it is the first entry and lists every other file. */
export const MANIFEST_FILE = 'addon.json';
/** The lock's name inside the service pack and in the development output. */
export const LOCK_FILE = 'addons.lock.json';

/** Where the mirror serves an archive: content-addressed and immutable (ops/release-downloads). */
export const MIRROR_ORIGIN = 'https://downloads.atd.best';
export const RELEASE_REPO = 'JUNERDD/Atd';

/** An archive's file name, also its GitHub release asset name. */
export function archiveName({ id, version, arch }) {
  return `Atd-addon-${id}-${version}-${arch}.tar.gz`;
}

/** The archives a packer run writes into its output directory (and removes from an earlier run). */
export const ARCHIVE_PATTERN = /^Atd-addon-.+\.tar\.gz$/;

/** The mirror's key for an archive, below the mirror's prefix. */
export function mirrorKey({ id, sha256 }) {
  return `addons/${id}/${sha256}.tar.gz`;
}

/** The URLs a release lock lists for an archive: the mirror first, then the GitHub asset. */
export function releaseUrls(artifact, appVersion) {
  return [
    `${MIRROR_ORIGIN}/${mirrorKey(artifact)}`,
    `https://github.com/${RELEASE_REPO}/releases/download/v${appVersion}/${archiveName(artifact)}`,
  ];
}

/**
 * The browser worker inside `computer-browser`, its `worker` entry: one ES module bundling the
 * worker with the MCP SDK, zod, the contracts and typebox. playwright-core stays files beside it:
 * the worker imports it at run time, and Playwright loads its own bundles, `package.json` and
 * `browsers.json` by path from its package directory, so it cannot be bundled.
 */
export const BROWSER_WORKER = 'worker.mjs';
/** playwright-core (Apache-2.0, licenses/playwright-core-LICENSE and -NOTICE). */
export const PLAYWRIGHT_CORE = 'playwright-core';
/** Licenses of the packages in the add-on, one file per package (NOTICE files beside them). */
export const BROWSER_LICENSES = 'licenses';

/**
 * What the add-on keeps of each run-time package, relative to the package. The worker attaches
 * over CDP only, so Playwright's CLI, browser installer, trace viewer, recorder, dashboard,
 * MCP tools, Electron loader and type declarations never ship; its Apache-2.0 LICENSE and
 * NOTICE, and the notices of the code its utilities bundle carries, do.
 */
export const RUNTIME_PACKAGES = Object.freeze({
  [PLAYWRIGHT_CORE]: Object.freeze([
    'LICENSE',
    'NOTICE',
    'ThirdPartyNotices.txt',
    'package.json',
    'browsers.json',
    'index.js',
    'index.mjs',
    'lib/bootstrap.js',
    'lib/coreBundle.js',
    'lib/utilsBundle.js',
    'lib/utilsBundle.js.LICENSE',
  ]),
});

/** A runtime package's directory inside the browser add-on. */
export function runtimePackageDir(name) {
  return path.posix.join('node_modules', name);
}

/** The pinned playwright-core the worker runs on (apps/agent-service/package.json). */
export const PLAYWRIGHT_CORE_VERSION = '1.63.0';
export const BROWSER_WORKER_VERSION = '0.6.0';

/** The worker's tool set, as its `capabilities` reports it (verify-app/worker-check.mjs). */
export const BROWSER_WORKER_TOOLS = Object.freeze([
  'list_pages',
  'observe',
  'fill',
  'press',
  'scroll',
  'wait',
  'navigate',
  'key',
  'select',
  'upload',
  'downloads',
  'cancel',
  'preview_start',
  'preview_read',
  'preview_stop',
  'page_focus',
  'open_page',
  'restore_windows',
]);
