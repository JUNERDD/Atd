/**
 * Trims the deployed service's virtual store to what the service and the generated-app toolchain
 * can reach. The pack carries that toolchain (`@atd/app-kit` with Vite, Rolldown, Tailwind, the
 * native TypeScript compiler and the packages apps may import), which the service runs offline
 * from inside the bundle, and npm, which installs the packages an app declares in its own sandbox.
 */
import { access, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Dependency links, by the package that declares them, that neither the service nor an app build
 * ever follows. Each rule must still match a staged package, so a dependency change that makes one
 * stale fails the pack instead of silently shipping more.
 */
const UNUSED_LINKS = new Map([
  // Optional peers: the builder passes Vite an inline config (no config file for jiti or yaml to
  // load), never asks for esbuild transforms, and never watches (fsevents).
  ['vite', ['esbuild', 'fsevents', 'jiti', 'yaml']],
  // Optional peers for the Babel pipeline and the React Compiler, which app builds do not enable.
  [
    '@vitejs/plugin-react',
    ['@rolldown/plugin-babel', 'babel-plugin-react-compiler', 'oxc-transform-react'],
  ],
  // @atd/ui uses the shadcn CLI package only for `shadcn/tailwind.css`, which app-kit vendors.
  ['@atd/ui', ['shadcn']],
]);

/**
 * Files of kept packages that nothing loads: Vite resolves lucide-react through its `module`
 * (ESM) entry and `tsc` through its `typings`, so the CommonJS build and the prefixed/suffixed
 * declaration variants (whose names the main declaration file already exports) go; npm's
 * documentation and man pages are never read by `npm ci` or `npm install`.
 */
const UNUSED_FILES = new Map([
  [
    'lucide-react',
    ['dist/cjs', 'dist/lucide-react.prefixed.d.ts', 'dist/lucide-react.suffixed.d.ts'],
  ],
  ['npm', ['docs', 'man']],
]);

/** True when `file` is `root` or lies inside it. */
function isInside(file, root) {
  return file === root || file.startsWith(`${root}${path.sep}`);
}

/** The packages in a `node_modules` directory (scopes expanded), skipping `.bin` and the like. */
async function packageEntries(modulesDir) {
  let entries;
  try {
    entries = await readdir(modulesDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const packages = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(modulesDir, entry.name);
    const scoped = entry.name.startsWith('@') && entry.isDirectory();
    const children = scoped ? await readdir(full, { withFileTypes: true }) : [entry];
    for (const child of children) {
      packages.push({
        name: scoped ? `${entry.name}/${child.name}` : child.name,
        path: scoped ? path.join(full, child.name) : full,
        link: child.isSymbolicLink(),
      });
    }
  }
  return packages;
}

/** The virtual-store entry (`.pnpm/<id>`) holding a package directory, or null outside it. */
function storeEntry(store, dir) {
  if (!isInside(dir, store)) return null;
  const parts = path.relative(store, dir).split(path.sep);
  const at = parts.indexOf('node_modules');
  return at > 0 ? path.join(store, ...parts.slice(0, at)) : null;
}

/**
 * Cuts the `UNUSED_LINKS`, then keeps only the virtual-store entries Node can still reach from
 * the pack's own dependencies through declared links, deletes the rest (including the unlinked
 * `.pnpm/@` copies pnpm 12's legacy deploy leaves) and the hoisted fallback links to them, and
 * trims `UNUSED_FILES` from what stays.
 */
export async function pruneStore(modules) {
  const store = path.join(modules, '.pnpm');
  const live = new Set();
  const pending = [];
  const matchedRules = new Set();
  let cut = 0;
  const follow = async (modulesDir, unused) => {
    for (const dep of await packageEntries(modulesDir)) {
      if (!dep.link) {
        await follow(path.join(dep.path, 'node_modules'), []);
      } else if (unused.includes(dep.name)) {
        await rm(dep.path);
        cut += 1;
      } else {
        const entry = storeEntry(store, await realpath(dep.path));
        if (entry !== null && !live.has(entry)) {
          live.add(entry);
          pending.push(entry);
        }
      }
    }
  };
  await follow(modules, []);
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const entryModules = path.join(entry, 'node_modules');
    const own = (await packageEntries(entryModules)).filter((dep) => !dep.link);
    const unused = own.flatMap((pkg) => {
      if (UNUSED_LINKS.has(pkg.name)) matchedRules.add(pkg.name);
      return UNUSED_LINKS.get(pkg.name) ?? [];
    });
    await follow(entryModules, unused);
    for (const pkg of own) {
      for (const file of UNUSED_FILES.get(pkg.name) ?? []) {
        await rm(path.join(pkg.path, file), { recursive: true });
      }
    }
  }
  const stale = [...UNUSED_LINKS.keys()].filter((name) => !matchedRules.has(name));
  if (stale.length > 0)
    throw new Error(`UNUSED_LINKS names packages the pack no longer has: ${stale.join(', ')}.`);

  let removed = 0;
  const removeDead = async (dir) => {
    for (const child of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, child.name);
      if (!child.isDirectory() || full === path.join(store, 'node_modules') || live.has(full))
        continue;
      if ([...live].some((entry) => isInside(entry, full))) {
        await removeDead(full);
      } else {
        await rm(full, { recursive: true });
        removed += 1;
      }
    }
  };
  await removeDead(store);
  const hoisted = path.join(store, 'node_modules');
  for (const dep of await packageEntries(hoisted)) {
    if (
      dep.link &&
      !(await access(dep.path).then(
        () => true,
        () => false,
      ))
    )
      await rm(dep.path);
  }
  for (const scope of await readdir(hoisted).catch(() => [])) {
    if (scope.startsWith('@') && (await readdir(path.join(hoisted, scope))).length === 0)
      await rm(path.join(hoisted, scope), { recursive: true });
  }
  process.stdout.write(
    `Pruned the virtual store: cut ${cut} unused links, kept ${live.size} entries, removed ${removed}\n`,
  );
}
