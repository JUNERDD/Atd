// @ts-check
/**
 * The builder child: `sandbox-exec -f builder.sb node --permission --allow-addons … build.mjs
 * <config JSON>`, spawned by `buildApp` (src/node/build.ts) with cwd = the staging directory and
 * an IPC channel. It never runs agent JavaScript: the Vite config is inline (no config file, no
 * env files, an inline PostCSS config so none is searched for) and the only plugins are React,
 * Tailwind and the module policy. It builds the page (`<out>/web`) and, when the app has one, the
 * backend as a single ESM file (`<out>/server/index.mjs`), then reports `{t:'buildResult'}`.
 */
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { build } from 'vite';
import { modulePolicy } from './resolver.mjs';

/**
 * @typedef {object} BuilderConfig
 * @property {string} stagingDir
 * @property {string} outDir
 * @property {boolean} hasServer
 * @property {string[]} webPackages
 * @property {string[]} serverPackages
 * @property {string[]} fence
 * @property {{ specifier: string, file: string }[]} cssAliases
 * @property {{ client: string, server: string }} sdk
 * @property {string} toolchainPackageJson
 */

/** @type {BuilderConfig} */
const config = JSON.parse(process.argv[2] ?? '{}');
/** @type {import('./resolver.mjs').BuildError[]} */
const errors = [];
const report = (/** @type {import('./resolver.mjs').BuildError} */ error) => errors.push(error);
const escape = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @type {import('vite').InlineConfig} */
const common = {
  configFile: false,
  envDir: false,
  logLevel: 'warn',
  clearScreen: false,
  cacheDir: path.join(config.outDir, '.vite-cache'),
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: config.cssAliases.map(({ specifier, file }) => ({
      find: new RegExp(`^${escape(specifier)}$`),
      replacement: file,
    })),
  },
};
const aliasFiles = new Set(config.cssAliases.map(({ file }) => file));
const fence = [config.stagingDir, ...config.fence];

/** @param {'web' | 'server'} side @param {string} viteRoot */
const policy = (side, viteRoot) =>
  modulePolicy({
    side,
    appRoot: config.stagingDir,
    viteRoot,
    allow: side === 'web' ? config.webPackages : config.serverPackages,
    sdk:
      side === 'web'
        ? { specifier: '@atd/app-kit/client', file: config.sdk.client }
        : { specifier: '@atd/app-kit/server', file: config.sdk.server },
    fence,
    aliasFiles,
    toolchainPackageJson: config.toolchainPackageJson,
    report,
  });

async function buildWeb() {
  const root = path.join(config.stagingDir, 'web');
  await build({
    ...common,
    root,
    base: './',
    plugins: [policy('web', root), react(), tailwind()],
    // WKWebView still needs prefixes such as `-webkit-user-select`.
    build: { outDir: path.join(config.outDir, 'web'), emptyOutDir: true, target: 'safari26' },
  });
}

async function buildServer() {
  await build({
    ...common,
    root: config.stagingDir,
    plugins: [policy('server', config.stagingDir)],
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: path.join(config.stagingDir, 'server', 'index.ts'),
      outDir: path.join(config.outDir, 'server'),
      emptyOutDir: true,
      target: 'node24',
      minify: false,
      copyPublicDir: false,
      rolldownOptions: {
        output: { format: 'esm', entryFileNames: 'index.mjs', codeSplitting: false },
      },
    },
  });
}

/** @param {unknown} message */
function finish(message) {
  const exit = () => process.exit(0);
  if (process.send) process.send(message, exit);
  else exit();
}

try {
  const started = performance.now();
  await buildWeb();
  const web = performance.now();
  if (config.hasServer) await buildServer();
  finish({
    t: 'buildResult',
    ok: true,
    timings: { webMs: Math.round(web - started), serverMs: Math.round(performance.now() - web) },
  });
} catch (error) {
  const message = stripVTControlCharacters(
    error instanceof Error ? error.message : String(error),
  ).slice(0, 8000);
  finish({
    t: 'buildResult',
    ok: false,
    errors: errors.length > 0 ? errors : [{ code: 'build_failed', message }],
  });
}
