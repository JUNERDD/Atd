/**
 * The `computer-browser` add-on's files: the service build's browser worker
 * (`apps/agent-service/dist/computer/worker/server.js`) bundled into one ES module with every
 * package it imports statically, the pruned playwright-core it imports at run time (layout.mjs:
 * RUNTIME_PACKAGES) and the licenses and notices of everything it contains. The result runs with the app's
 * pinned Node from wherever the service unpacks it, with no install step.
 *
 * The bundler is Rolldown, which the workspace already installs as Vite's own dependency
 * (through `@atd/app-kit`'s pinned Vite), so packing adds no dependency of its own.
 */
import { createHash } from 'node:crypto';
import { access, readdir, readFile, realpath } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BROWSER_LICENSES,
  BROWSER_WORKER,
  COMPUTER_BROWSER,
  PLAYWRIGHT_CORE,
  PLAYWRIGHT_CORE_VERSION,
  RUNTIME_PACKAGES,
  runtimePackageDir,
} from './layout.mjs';

const WORKER_SOURCE = path.join('apps', 'agent-service', 'dist', 'computer', 'worker', 'server.js');
const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

async function loadRolldown(repoRoot) {
  try {
    const appKit = createRequire(path.join(repoRoot, 'packages', 'app-kit', 'package.json'));
    const vite = createRequire(appKit.resolve('vite/package.json'));
    return await import(pathToFileURL(vite.resolve('rolldown')).href);
  } catch (error) {
    throw new Error(`Cannot load Rolldown through @atd/app-kit's Vite; run pnpm install.`, {
      cause: error,
    });
  }
}

/**
 * Bundles the worker. Only Node built-ins and playwright-core may stay imports: anything else external would
 * be missing from the add-on. Module paths in the output are relative to the repository, so the
 * bundle names no machine's paths and the same sources give the same bytes.
 */
async function bundleWorker(repoRoot) {
  const input = path.join(repoRoot, WORKER_SOURCE);
  await access(input).catch(() => {
    throw new Error(`Missing ${input}. Run \`pnpm build\` before packing the add-ons.`);
  });
  const { rolldown } = await loadRolldown(repoRoot);
  const bundle = await rolldown({
    input,
    cwd: repoRoot,
    platform: 'node',
    external: [PLAYWRIGHT_CORE],
    logLevel: 'warn',
  });
  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false });
    if (output.length !== 1) throw new Error(`The worker bundle has ${output.length} outputs.`);
    const [chunk] = output;
    const stray = chunk.imports.filter((name) => name !== PLAYWRIGHT_CORE && !isBuiltin(name));
    if (stray.length > 0) throw new Error(`The worker bundle still imports ${stray.join(', ')}.`);
    if (chunk.code.includes(repoRoot)) throw new Error('The worker bundle names a local path.');
    return { code: Buffer.from(chunk.code), modules: chunk.moduleIds };
  } finally {
    await bundle.close();
  }
}

/** The directory of the package a bundled module belongs to, or null outside node_modules. */
function packageRoot(moduleId) {
  const marker = `${path.sep}node_modules${path.sep}`;
  const at = moduleId.lastIndexOf(marker);
  if (at === -1) return null;
  const rest = moduleId.slice(at + marker.length).split(path.sep);
  return (
    moduleId.slice(0, at + marker.length) +
    rest.slice(0, rest[0].startsWith('@') ? 2 : 1).join(path.sep)
  );
}

async function licenseOf(dir, label) {
  const name = (await readdir(dir)).find((file) => LICENSE_FILE.test(file));
  if (!name) throw new Error(`${label} (${dir}) ships no license file to include.`);
  return readFile(path.join(dir, name));
}

/**
 * One license file per package bundled into the worker, named after the package; the
 * repository's own license covers the worker and the workspace packages it bundles.
 */
async function bundledLicenses(repoRoot, modules) {
  const roots = new Set();
  for (const id of modules) {
    if (id.startsWith('\0')) continue;
    const root = packageRoot(id);
    if (root !== null) roots.add(await realpath(root));
    else if (!id.startsWith(`${repoRoot}${path.sep}`)) throw new Error(`Unexpected module ${id}.`);
  }
  const files = [
    {
      path: `${BROWSER_LICENSES}/atd-LICENSE`,
      data: await readFile(path.join(repoRoot, 'LICENSE')),
    },
  ];
  for (const root of roots) {
    const { name } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const slug = name.replace(/^@/, '').replace('/', '-');
    files.push({ path: `${BROWSER_LICENSES}/${slug}-LICENSE`, data: await licenseOf(root, name) });
  }
  return files;
}

/** The files `RUNTIME_PACKAGES` keeps of `name`, as the agent service resolves it. */
async function runtimePackage(repoRoot, name) {
  const service = createRequire(path.join(repoRoot, 'apps', 'agent-service', 'package.json'));
  const dir = await realpath(path.dirname(service.resolve(`${name}/package.json`)));
  const files = [];
  for (const file of RUNTIME_PACKAGES[name]) {
    const data = await readFile(path.join(dir, file)).catch(() => {
      throw new Error(`${name} no longer ships ${file} (${dir}).`);
    });
    files.push({ path: path.posix.join(runtimePackageDir(name), file), data });
  }
  return files;
}

/** playwright-core's LICENSE and NOTICE again under `licenses/`, beside the bundle's. */
function playwrightNotices(files) {
  const dir = runtimePackageDir(PLAYWRIGHT_CORE);
  return ['LICENSE', 'NOTICE'].map((name) => ({
    path: `${BROWSER_LICENSES}/${PLAYWRIGHT_CORE}-${name}`,
    data: files.find(({ path: file }) => file === `${dir}/${name}`).data,
  }));
}

/**
 * Builds the add-on's payload. Its version is the pinned playwright-core's plus the first 8 hex
 * digits of a hash over every file, so a changed worker shows as a new version.
 */
export async function browserPayload({ repoRoot }) {
  const { code, modules } = await bundleWorker(repoRoot);
  const playwright = await runtimePackage(repoRoot, PLAYWRIGHT_CORE);
  const files = [
    { path: BROWSER_WORKER, data: code },
    ...playwright,
    ...playwrightNotices(playwright),
    ...(await bundledLicenses(repoRoot, modules)),
  ].map((file) => ({ ...file, executable: false }));
  const manifest = playwright.find(
    ({ path: file }) => file === `${runtimePackageDir(PLAYWRIGHT_CORE)}/package.json`,
  );
  const playwrightVersion = JSON.parse(manifest.data.toString('utf8')).version;
  if (playwrightVersion !== PLAYWRIGHT_CORE_VERSION)
    throw new Error(
      `${PLAYWRIGHT_CORE} is ${playwrightVersion}, not the pinned ${PLAYWRIGHT_CORE_VERSION}.`,
    );
  const tree = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1)))
    tree.update(`${file.path}\0${createHash('sha256').update(file.data).digest('hex')}\n`);
  return {
    id: COMPUTER_BROWSER,
    version: `${playwrightVersion}-${tree.digest('hex').slice(0, 8)}`,
    entries: { worker: BROWSER_WORKER },
    files,
  };
}
