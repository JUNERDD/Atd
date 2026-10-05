import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { cssDirective } from '../staging.js';
import { PROVIDED_PACKAGES } from '../toolchain.js';
import { isReservedName } from './declared.js';
import { DependencyFailure, dependencyFailure, type DependencyError } from './errors.js';

/**
 * The two audits around `npm ci`: the lockfile before anything is downloaded, and the extracted
 * tree before it is sealed. Both refuse what Atd never lets into an app build, with a code the
 * agent can act on.
 */

/** Packages one app's dependency tree may hold. */
export const MAX_PACKAGES = 600;
export const MAX_TREE_BYTES = 256 * 1024 * 1024;
export const MAX_TREE_FILES = 60_000;
/** Errors one audit reports at most. */
const MAX_ERRORS = 20;

/** The lockfile fields the audit reads; npm writes more, which pass through unread. */
const LockEntrySchema = Type.Object({
  name: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  resolved: Type.Optional(Type.String()),
  integrity: Type.Optional(Type.String()),
  link: Type.Optional(Type.Boolean()),
  optional: Type.Optional(Type.Boolean()),
  inBundle: Type.Optional(Type.Boolean()),
  hasInstallScript: Type.Optional(Type.Boolean()),
  dependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
  peerDependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
});
type LockEntry = Static<typeof LockEntrySchema>;
const LockfileSchema = Type.Object({
  lockfileVersion: Type.Literal(3),
  packages: Type.Record(Type.String(), LockEntrySchema),
});

export interface LockAudit {
  /** The version npm locked for each declared package. */
  resolved: Record<string, string>;
  /** Entries npm installs (optional ones are omitted). */
  packages: number;
  notes: string[];
}

const NODE_MODULES = 'node_modules/';

/** The package name of a lockfile key such as `node_modules/a/node_modules/@s/b`. */
function keyName(key: string): string {
  return key.slice(key.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
}

/** Whether two name → range records hold the same entries. */
function sameRecord(a: Record<string, string> | undefined, b: Record<string, string>): boolean {
  const left = a ?? {};
  const keys = Object.keys(b);
  return Object.keys(left).length === keys.length && keys.every((key) => left[key] === b[key]);
}

/** ` (needed by x)` for a package the app did not declare itself. */
function neededBy(packages: Record<string, LockEntry>, key: string, name: string): string {
  const nested = key.lastIndexOf(`/${NODE_MODULES}`);
  if (nested > 0) return ` (needed by ${keyName(key.slice(0, nested))})`;
  if (packages['']?.dependencies?.[name] !== undefined) return '';
  const parent = Object.entries(packages).find(
    ([other, entry]) =>
      other !== '' &&
      (entry.dependencies?.[name] !== undefined || entry.peerDependencies?.[name] !== undefined),
  );
  return parent ? ` (needed by ${parent[1].name ?? keyName(parent[0])})` : '';
}

/**
 * Checks a lockfile before anything is downloaded. It must belong to the generated package.json
 * (its root entry names the same packages and peers), and every entry npm installs must come from
 * `registry` with an sha512 integrity (a bundled entry comes inside such a tarball), must not be a
 * link or run an install script, and must not be under `@atd`; at most `MAX_PACKAGES` of them.
 */
export function auditLock(
  text: string,
  expected: { dependencies: Record<string, string>; peerDependencies: Record<string, string> },
  registry: string,
): LockAudit {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Reported below with every other unreadable lockfile.
  }
  if (!Value.Check(LockfileSchema, parsed))
    throw dependencyFailure('dependency_failed', 'npm wrote a lockfile Atd cannot read.');
  const { packages } = parsed;
  const root = packages[''];
  if (
    !sameRecord(root?.dependencies, expected.dependencies) ||
    !sameRecord(root?.peerDependencies, expected.peerDependencies)
  )
    throw dependencyFailure(
      'dependency_failed',
      'The lockfile does not match the declared packages.',
    );
  const errors: DependencyError[] = [];
  const notes: string[] = [];
  let installed = 0;
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '' || entry.optional) continue;
    installed += 1;
    const name = entry.name ?? keyName(key);
    const label = `${name} ${entry.version ?? ''}`.trim() + neededBy(packages, key, name);
    if (isReservedName(name))
      errors.push({
        code: 'dependency_not_allowed',
        message: `${label} is in the @atd scope, which is reserved.`,
      });
    const registered =
      entry.resolved?.startsWith(registry) === true &&
      entry.integrity?.startsWith('sha512-') === true;
    if (entry.link === true || (entry.inBundle !== true && !registered))
      errors.push({
        code: 'dependency_source',
        message: `${label} resolves outside the npm registry.`,
      });
    if (entry.hasInstallScript === true)
      errors.push({
        code: 'dependency_install_script',
        message: `${label} runs an install script, which Atd never runs; choose a package without one.`,
      });
    if (key.includes(`/${NODE_MODULES}`) && PROVIDED_PACKAGES.includes(name))
      notes.push(`${label} brings its own ${name}; the app uses Atd's copy.`);
  }
  if (installed > MAX_PACKAGES)
    errors.push({
      code: 'dependency_too_large',
      message: `The dependencies need ${installed} packages; an app may use ${MAX_PACKAGES}.`,
    });
  if (errors.length > 0) throw new DependencyFailure(errors.slice(0, MAX_ERRORS));
  const resolved = Object.fromEntries(
    Object.keys(expected.dependencies).map((name) => [
      name,
      packages[`${NODE_MODULES}${name}`]?.version ?? '',
    ]),
  );
  return { resolved, packages: installed, notes };
}

/** First bytes of Mach-O images: thin 32/64-bit in either byte order, and universal. */
const MACH_O = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'cafebabf']);

/** A file's package (its last `node_modules/<name>`) and its path inside that package. */
function locate(relative: string): { pkg: string; file: string } {
  const parts = relative.split(path.sep);
  const at = parts.lastIndexOf('node_modules');
  const width = parts[at + 1]?.startsWith('@') ? 2 : 1;
  return {
    pkg: parts.slice(at + 1, at + 1 + width).join('/'),
    file: parts.slice(at + 1 + width).join('/'),
  };
}

/** Size and first four bytes of a file, and its text for a stylesheet; never follows a link. */
async function inspect(file: string, css: boolean) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const { size } = await handle.stat();
    if (css) return { size, head: '', text: await handle.readFile('utf8') };
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    return { size, head: bytesRead === 4 ? head.toString('hex') : '', text: null };
  } finally {
    await handle.close();
  }
}

/**
 * Checks an installed tree before it is sealed, reading entries without following links: a link
 * or a special file fails (Node's permission model follows links out of its grants, so the tree
 * must have none; `--no-bin-links` keeps npm from making them); so do native code (a `.node`
 * addon or a Mach-O image), package CSS with a Tailwind directive (Tailwind compiles package CSS
 * too, and `@plugin` runs code in the builder, X2 E5), and more than `MAX_TREE_BYTES` or
 * `MAX_TREE_FILES`.
 */
export async function auditTree(dir: string): Promise<{ files: number; bytes: number }> {
  const errors: DependencyError[] = [];
  const native = new Set<string>();
  let files = 0;
  let bytes = 0;
  const pending = [path.join(dir, 'node_modules')];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      const { pkg, file } = locate(path.relative(dir, full));
      if (!entry.isFile()) {
        const message = `${pkg} contains ${file}, which is not a regular file; apps cannot use it.`;
        errors.push({ code: 'dependency_failed', message });
        continue;
      }
      const found = await inspect(full, entry.name.endsWith('.css'));
      files += 1;
      bytes += found.size;
      if (bytes > MAX_TREE_BYTES)
        throw dependencyFailure(
          'dependency_too_large',
          `The dependencies unpack to more than ${MAX_TREE_BYTES / 1024 / 1024} MiB, the most an app may use.`,
        );
      if (files > MAX_TREE_FILES)
        throw dependencyFailure(
          'dependency_too_large',
          `The dependencies hold more than ${MAX_TREE_FILES} files, the most an app may use.`,
        );
      if ((entry.name.endsWith('.node') || MACH_O.has(found.head)) && !native.has(pkg)) {
        native.add(pkg);
        const message = `${pkg} ships native code (${file}), which apps cannot load.`;
        errors.push({ code: 'dependency_native_code', message });
      }
      const directive = found.text === null ? null : cssDirective(found.text);
      if (directive)
        errors.push({
          code: 'dependency_css_directive',
          message: `${pkg}/${file}:${directive.line}: "@${directive.directive}" is not allowed in package CSS.`,
        });
      if (errors.length >= MAX_ERRORS) throw new DependencyFailure(errors);
    }
  }
  if (errors.length > 0) throw new DependencyFailure(errors);
  return { files, bytes };
}
