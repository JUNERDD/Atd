import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where app-kit and the fixed toolchain live on disk, resolved once from app-kit's own
 * `package.json`. Every path is a realpath: pnpm links, macOS `/var` → `/private/var`, and the
 * sandbox profiles and `--allow-fs-read` flags all compare real paths.
 */

/** Bare packages app page code may import (plus `@atd/app-kit/client`). */
export const WEB_PACKAGES = [
  'react',
  'react-dom',
  '@atd/ui',
  'lucide-react',
  'motion',
  '@tanstack/react-query',
  'typebox',
  'tailwindcss',
] as const;
/** Bare packages app backend code may import (plus `@atd/app-kit/server` and `node:` builtins). */
export const SERVER_PACKAGES = ['typebox'] as const;

/** An exact import specifier the builder pins to a toolchain file. */
export interface ModuleAlias {
  specifier: string;
  file: string;
}

export interface Toolchain {
  /** The app-kit package directory. */
  root: string;
  packageJson: string;
  runtimeDir: string;
  builderScript: string;
  /**
   * Directories holding the toolchain's code and its dependency closure (the pnpm store, or the
   * hoisted `node_modules`, and workspace packages such as `@atd/ui`): what the builder and `tsc`
   * may read, and where bundled modules may come from.
   */
  readRoots: string[];
  /**
   * Specifiers resolved to fixed files. Tailwind resolves CSS `@import`s with a resolver that
   * skips plugin `resolveId` hooks but honors `resolve.alias`, so CSS-reachable packages are pinned
   * here; the SDK entries are pinned so app code reaches only the side it runs on.
   */
  cssAliases: ModuleAlias[];
  sdk: { client: string; server: string };
  /** The native TypeScript compiler binary. */
  tsc: string;
  /** Packages an app typecheck sees in its `node_modules`, by name. */
  typePackages: Record<string, string>;
}

const PNPM_STORE = `${path.sep}node_modules${path.sep}.pnpm${path.sep}`;
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

export function realpath(file: string): string {
  return fs.realpathSync.native(file);
}

/** True when `file` is `root` or lies inside it. */
export function isInside(file: string, root: string): boolean {
  return file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** The directory a dependency's whole closure lives under, for a dependency's real directory. */
function closureRoot(dir: string): string {
  const store = dir.indexOf(PNPM_STORE);
  if (store >= 0) return dir.slice(0, store + PNPM_STORE.length - 1);
  const hoisted = dir.lastIndexOf(NODE_MODULES);
  return hoisted >= 0 ? dir.slice(0, hoisted + NODE_MODULES.length - 1) : dir;
}

/** `roots` without duplicates and without entries inside another entry. */
function outermost(roots: string[]): string[] {
  const unique = [...new Set(roots)].sort((a, b) => a.length - b.length);
  return unique.filter(
    (root, index) => !unique.slice(0, index).some((outer) => isInside(root, outer)),
  );
}

function readJson(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object.`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

/** The CSS entry of a package: its `exports["."].style`, else its `style` field. */
function styleEntry(packageDir: string): string {
  const pkg = readJson(path.join(packageDir, 'package.json'));
  const dot: unknown =
    pkg.exports !== null && typeof pkg.exports === 'object' ? Reflect.get(pkg.exports, '.') : null;
  const style: unknown =
    dot !== null && typeof dot === 'object' ? Reflect.get(dot, 'style') : pkg.style;
  if (typeof style !== 'string') throw new Error(`${packageDir} has no CSS entry.`);
  return path.join(packageDir, style);
}

/**
 * The real directory of package `name` as Node would find it from `fromDir`: the nearest
 * `node_modules/<name>` up the tree (works for packages whose `exports` hide `package.json`).
 */
function packageDir(name: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return realpath(candidate);
    if (path.dirname(dir) === dir) throw new Error(`Cannot find ${name} from ${fromDir}.`);
  }
}

function dependencyNames(packageDirectory: string): string[] {
  const dependencies = readJson(path.join(packageDirectory, 'package.json')).dependencies;
  return dependencies !== null && typeof dependencies === 'object' ? Object.keys(dependencies) : [];
}

/**
 * The closure roots of `root`'s dependencies. A store or hoisted `node_modules` root covers the
 * packages inside it; a workspace package (linked from outside any `node_modules`) is its own
 * root, and its dependencies are followed in turn (`@atd/agent-contracts` → `@atd/plugin-kit`).
 */
function dependencyRoots(root: string): string[] {
  const roots = new Set<string>();
  const pending = [root];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const name of dependencyNames(dir)) {
      const found = packageDir(name, dir);
      const closure = closureRoot(found);
      if (roots.has(closure)) continue;
      roots.add(closure);
      if (closure === found) pending.push(found);
    }
  }
  return [...roots];
}

let cached: Toolchain | null = null;

/** The toolchain of this app-kit install; resolved once per process. */
export function loadToolchain(): Toolchain {
  if (cached) return cached;
  const root = realpath(fileURLToPath(new URL('../..', import.meta.url)));
  const packageJson = path.join(root, 'package.json');
  const require = createRequire(packageJson);
  const dependencyDir = (name: string) => packageDir(name, root);
  const ui = dependencyDir('@atd/ui');

  const typescript = dependencyDir('typescript');
  const platformCompiler = createRequire(path.join(typescript, 'package.json')).resolve(
    `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
  );

  const typePackageNames = [
    ...WEB_PACKAGES,
    '@atd/agent-contracts',
    '@types/node',
    '@types/react',
    '@types/react-dom',
  ];
  cached = {
    root,
    packageJson,
    runtimeDir: path.join(root, 'runtime'),
    builderScript: path.join(root, 'builder', 'build.mjs'),
    readRoots: outermost([root, ...dependencyRoots(root)]),
    cssAliases: [
      { specifier: '@atd/ui/styles.css', file: realpath(require.resolve('@atd/ui/styles.css')) },
      { specifier: 'tailwindcss', file: realpath(styleEntry(dependencyDir('tailwindcss'))) },
      {
        specifier: 'tw-animate-css',
        file: realpath(styleEntry(packageDir('tw-animate-css', ui))),
      },
      { specifier: 'shadcn/tailwind.css', file: path.join(root, 'vendor', 'shadcn-tailwind.css') },
    ],
    sdk: {
      client: path.join(root, 'src', 'sdk', 'client', 'index.ts'),
      server: path.join(root, 'src', 'sdk', 'server', 'index.ts'),
    },
    tsc: realpath(path.join(path.dirname(platformCompiler), 'lib', 'tsc')),
    typePackages: {
      ...Object.fromEntries(typePackageNames.map((name) => [name, dependencyDir(name)])),
      '@atd/app-kit': root,
    },
  };
  return cached;
}

export interface NodeBinary {
  /** The path to exec. */
  path: string;
  /** Its realpath (Seatbelt matches exec rules on both). */
  realPath: string;
  /** The installation prefix (`<prefix>/bin/node`), which Node reads at startup. */
  prefix: string;
}

export function nodeBinary(nodePath: string = process.execPath): NodeBinary {
  const realPath = realpath(nodePath);
  return { path: nodePath, realPath, prefix: path.dirname(path.dirname(realPath)) };
}
