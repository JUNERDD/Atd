// @ts-check
/**
 * The builder's module policy, as a Vite plugin. App source (files under the staging directory)
 * may import only relative files inside the app, the allow-listed packages of its side, the
 * packages it declares, its SDK entry, and (backend only) `node:` builtins; allow-listed imports
 * resolve from app-kit's own toolchain and declared ones from the app's dependency tree, never
 * from anything near the app. Inside the tree, imports of a provided package resolve to the
 * toolchain's copy too, so a page never bundles a second React. Two hooks back that up where
 * `resolveId` is not consulted: a load fence (rolldown and Tailwind's oxide are native addons that
 * read files themselves, so `--allow-fs-read` does not limit what gets bundled; T1 saw an outside
 * file bundled) and a check of CSS: app `@import`s (Tailwind resolves those without plugin
 * `resolveId` hooks) and, in package CSS, the directives the tree audit already refused.
 */
import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';

/** @typedef {{ code: string, message: string, file?: string }} BuildError */
/**
 * @typedef {object} PolicyOptions
 * @property {'web' | 'server'} side
 * @property {string} appRoot The staging directory (a realpath).
 * @property {string} viteRoot This build's Vite root (root-relative `/x` imports resolve here).
 * @property {string[]} allow Bare packages app code may import on this side.
 * @property {{ specifier: string, file: string }} sdk The SDK entry for this side.
 * @property {string[]} fence Directories bundled modules may come from (app root included).
 * @property {Set<string>} aliasFiles Toolchain files `resolve.alias` pins specifiers to.
 * @property {string} toolchainPackageJson Bare imports resolve as if from this file.
 * @property {(error: BuildError) => void} report Records a structured error before failing.
 * @property {{ root: string, packageJson: string, names: string[] } | null} deps The app's
 *   dependency tree, whose declared names app code may import; null when it declares none.
 * @property {string[]} provided Packages bundled once from the toolchain, also for the tree.
 * @property {Set<string>} used Receives the tree packages this bundle took modules from.
 */

/** CSS `@import`s app styles may name besides relative files. */
const CSS_PACKAGES = new Set(['@atd/ui', 'tailwindcss']);
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Tailwind directives that load code into the builder or point its scanner elsewhere. */
const CSS_DIRECTIVE = /@(plugin|config|source|reference)\b/;

/** @param {string} specifier */
function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/** @param {string} file @param {string} root */
function inside(file, root) {
  return file === root || file.startsWith(root + path.sep);
}

/** @param {string} id */
const withoutQuery = (id) => id.split('?')[0] ?? id;

/** The package of a file inside a dependency tree: its last `node_modules/<name>`. */
function treePackage(/** @type {string} */ file, /** @type {string} */ root) {
  const parts = path.relative(root, file).split(path.sep);
  const at = parts.lastIndexOf('node_modules');
  const name = parts[at + 1] ?? '';
  return name.startsWith('@') ? `${name}/${parts[at + 2] ?? ''}` : name;
}

/**
 * @param {PolicyOptions} options
 * @returns {import('vite').Plugin}
 */
export function modulePolicy(options) {
  const { appRoot, side, report, deps } = options;
  const allow = new Set(options.allow);
  const declared = new Set(deps?.names ?? []);
  const provided = new Set(options.provided);
  const relativeName = (/** @type {string} */ file) => path.relative(appRoot, withoutQuery(file));
  /** @type {(code: string, message: string, file?: string) => never} */
  let fail = () => {
    throw new Error('unreachable');
  };

  return {
    name: `app-kit:module-policy:${side}`,
    enforce: 'pre',
    buildStart() {
      fail = (code, message, file) => {
        report(file === undefined ? { code, message } : { code, message, file });
        return this.error(message);
      };
    },
    async resolveId(source, importer, resolveOptions) {
      if (source.startsWith('\0') || source.startsWith('virtual:')) return null;
      // Helpers Vite injects into the page and its chunks.
      if (source === 'vite/modulepreload-polyfill' || source === 'vite/preload-helper') return null;
      const importerFile = importer ? withoutQuery(importer) : null;
      const fromApp = importerFile === null || inside(importerFile, appRoot);
      // `BuildError.file` is relative to the app, like the name in the message.
      const importerName = importerFile ? relativeName(importerFile) : undefined;
      const where = importerName ? ` in ${importerName}` : '';
      const name = packageName(source);
      const fromToolchain = () =>
        this.resolve(source, options.toolchainPackageJson, { ...resolveOptions, skipSelf: true });
      if (!fromApp) {
        // `@atd/ui` sources import themselves by name, and no link to it sits next to them.
        if (name === '@atd/ui') return fromToolchain();
        // One copy of each provided package per bundle, whatever the tree holds.
        if (deps && inside(importerFile ?? '', deps.root) && provided.has(name))
          return fromToolchain();
        return null;
      }
      if (source === options.sdk.specifier) return options.sdk.file;
      if (source.startsWith('node:') || isBuiltin(source)) {
        if (side === 'server') return null;
        return fail(
          'import_not_allowed',
          `Import "${source}"${where}: Node built-ins are only available to the backend.`,
          importerName,
        );
      }
      if (source.startsWith('data:')) return null;
      if (URL_SCHEME.test(source)) {
        return fail(
          'import_not_allowed',
          `Import "${source}"${where}: URL imports are not allowed.`,
          importerName,
        );
      }
      const file = withoutQuery(source);
      if (source.startsWith('.')) {
        const target = path.resolve(
          importerFile ? path.dirname(importerFile) : options.viteRoot,
          file,
        );
        if (inside(target, appRoot)) return null;
        return fail(
          'outside_app',
          `Import "${source}"${where} points outside the app.`,
          importerName,
        );
      }
      if (path.isAbsolute(file)) {
        if (inside(file, appRoot) || options.aliasFiles.has(file)) return null;
        // `/src/x.ts` in a page means `<web root>/src/x.ts` (Vite tries that first when it exists).
        const rootRelative = path.join(options.viteRoot, file);
        if (side === 'web' && inside(rootRelative, appRoot) && fs.existsSync(rootRelative))
          return null;
        return fail(
          'outside_app',
          `Import "${source}"${where} points outside the app.`,
          importerName,
        );
      }
      if (allow.has(name)) return fromToolchain();
      if (deps && declared.has(name))
        return this.resolve(source, deps.packageJson, { ...resolveOptions, skipSelf: true });
      const allowed = [...allow, ...declared, options.sdk.specifier].sort().join(', ');
      const declarable = !provided.has(name) && !name.startsWith('@atd/');
      const hint = declarable
        ? ' To use another npm package, declare it in atd-app.json "dependencies".'
        : '';
      return fail(
        'import_not_allowed',
        `Import "${source}"${where} is not available to apps. Allowed on the ${side === 'web' ? 'page' : 'backend'}: ${allowed}.${hint}`,
        importerName,
      );
    },
    load: {
      order: 'pre',
      handler(id) {
        if (id.startsWith('\0')) return null;
        const file = withoutQuery(id);
        if (!path.isAbsolute(file)) return null;
        if (options.fence.some((root) => inside(file, root))) return null;
        return fail('load_outside', `Refusing to load ${file}: outside the app and the toolchain.`);
      },
    },
    transform: {
      order: 'pre',
      filter: { id: /\.css(\?|$)/ },
      handler(code, id) {
        const file = withoutQuery(id);
        if (deps && inside(file, deps.root)) {
          const match = CSS_DIRECTIVE.exec(code.replace(/\/\*[\s\S]*?\*\//g, ''));
          if (match) {
            const relative = path.relative(path.join(deps.root, 'node_modules'), file);
            fail(
              'dependency_css_directive',
              `${relative}: "@${match[1]}" is not allowed in package CSS.`,
            );
          }
          return null;
        }
        if (!inside(file, appRoot)) return null;
        const css = code.replace(/\/\*[\s\S]*?\*\//g, '');
        for (const match of css.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)) {
          const specifier = match[1] ?? '';
          const target = path.resolve(path.dirname(file), specifier);
          const ok = specifier.startsWith('.')
            ? inside(target, appRoot)
            : !path.isAbsolute(specifier) &&
              !URL_SCHEME.test(specifier) &&
              CSS_PACKAGES.has(packageName(specifier));
          if (!ok) {
            fail(
              'css_import',
              `${relativeName(file)}: CSS import "${specifier}" is not available to apps.`,
              relativeName(file),
            );
          }
        }
        return null;
      },
    },
    ...(deps
      ? {
          generateBundle(_, bundle) {
            for (const item of Object.values(bundle)) {
              if (item.type !== 'chunk') continue;
              for (const id of item.moduleIds) {
                const file = withoutQuery(id);
                if (inside(file, deps.root)) options.used.add(treePackage(file, deps.root));
              }
            }
          },
        }
      : {}),
  };
}
