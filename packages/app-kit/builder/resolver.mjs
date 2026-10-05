// @ts-check
/**
 * The builder's module policy, as a Vite plugin. App source (files under the staging directory)
 * may import only relative files inside the app, the allow-listed packages of its side, its SDK
 * entry, and (backend only) `node:` builtins; bare imports resolve from app-kit's own toolchain,
 * never from anything near the app. Two hooks back that up where `resolveId` is not consulted:
 * a load fence (rolldown and Tailwind's oxide are native addons that read files themselves, so
 * `--allow-fs-read` does not limit what gets bundled; T1 saw an outside file bundled) and a check
 * of app CSS `@import`s (Tailwind resolves those without plugin `resolveId` hooks).
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
 */

/** CSS `@import`s app styles may name besides relative files. */
const CSS_PACKAGES = new Set(['@atd/ui', 'tailwindcss']);
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

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

/**
 * @param {PolicyOptions} options
 * @returns {import('vite').Plugin}
 */
export function modulePolicy(options) {
  const { appRoot, side, report } = options;
  const allow = new Set(options.allow);
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
      const where = importerFile ? ` in ${relativeName(importerFile)}` : '';
      const name = packageName(source);
      if (!fromApp) {
        // `@atd/ui` sources import themselves by name, and no link to it sits next to them.
        if (name === '@atd/ui') {
          return this.resolve(source, options.toolchainPackageJson, {
            ...resolveOptions,
            skipSelf: true,
          });
        }
        return null;
      }
      if (source === options.sdk.specifier) return options.sdk.file;
      if (source.startsWith('node:') || isBuiltin(source)) {
        if (side === 'server') return null;
        return fail(
          'import_not_allowed',
          `Import "${source}"${where}: Node built-ins are only available to the backend.`,
          importerFile ?? undefined,
        );
      }
      if (source.startsWith('data:')) return null;
      if (URL_SCHEME.test(source)) {
        return fail(
          'import_not_allowed',
          `Import "${source}"${where}: URL imports are not allowed.`,
          importerFile ?? undefined,
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
          importerFile ?? undefined,
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
          importerFile ?? undefined,
        );
      }
      if (!allow.has(name)) {
        const allowed = [...allow, options.sdk.specifier].sort().join(', ');
        return fail(
          'import_not_allowed',
          `Import "${source}"${where} is not available to apps. Allowed on the ${side === 'web' ? 'page' : 'backend'}: ${allowed}.`,
          importerFile ?? undefined,
        );
      }
      return this.resolve(source, options.toolchainPackageJson, {
        ...resolveOptions,
        skipSelf: true,
      });
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
  };
}
