import { PROVIDED_PACKAGES, TOOLCHAIN_PACKAGES } from '../toolchain.js';
import type { DependencyError } from './errors.js';

/**
 * The npm packages an app declares in `atd-app.json` `dependencies` (name → version or `^`/`~`
 * range), already checked against the manifest schema, which also bounds their number. What the
 * schema cannot know depends on the toolchain: packages Atd provides, the packages of the build
 * itself and the reserved `@atd` scope are refused here.
 */
export type DeclaredDependencies = Record<string, string>;

/** True for a package name under the reserved `@atd` scope. */
export function isReservedName(name: string): boolean {
  return name.startsWith('@atd/');
}

/** A toolchain entry matches its own name, or every package of an `@scope/*` entry. */
function isToolchainName(name: string): boolean {
  return TOOLCHAIN_PACKAGES.some((entry) =>
    entry.endsWith('/*') ? name.startsWith(entry.slice(0, -1)) : name === entry,
  );
}

/** Declarations the toolchain refuses, in name order. */
export function declaredErrors(declared: DeclaredDependencies): DependencyError[] {
  return Object.keys(declared)
    .sort()
    .flatMap((name): DependencyError[] => {
      const reason = PROVIDED_PACKAGES.includes(name)
        ? 'is already provided by Atd; import it without declaring it'
        : isToolchainName(name)
          ? 'is part of the app build and cannot be declared'
          : isReservedName(name)
            ? 'is in the @atd scope, which is reserved'
            : null;
      if (reason === null) return [];
      const message = `dependencies: "${name}" ${reason}.`;
      return [{ code: 'dependency_not_allowed', file: 'atd-app.json', message }];
    });
}

/** `record` with its keys in code-unit order, so the text never depends on the locale. */
function sorted(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * The `package.json` npm resolves and installs for an app: its declared packages, plus Atd's
 * React packages as root peers at the toolchain's exact versions. npm then refuses a package
 * whose React peer range excludes Atd's React (ERESOLVE) instead of installing a second React,
 * and the tree carries the React types its packages' declarations resolve against. There are no
 * `overrides`: they would silence that peer check. The text is fixed for given inputs, so the
 * service compares it with a version's recorded copy byte for byte.
 */
export function dependencyPackageJson(
  declared: DeclaredDependencies,
  peerPins: Record<string, string>,
): string {
  const manifest = {
    name: 'atd-app-deps',
    version: '0.0.0',
    private: true,
    dependencies: sorted(declared),
    peerDependencies: sorted(peerPins),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
