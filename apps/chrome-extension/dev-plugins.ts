import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { DEV_BUILD_FILE, type DevBuild } from './src/dev-build.ts';

/**
 * What the dev flavor's build adds so `pnpm dev:extension` can reload the extension after every
 * change: the content script's sources join the watch, and each build leaves a new stamp.
 */
export function devPlugins(contentEntry: string): Plugin[] {
  return [watchContentScript(contentEntry), devBuildStamp()];
}

/** Files whose imports the content script's graph follows; others (CSS, JSON, SVG) only count. */
const SCRIPT = /\.[cm]?[jt]sx?$/;

/**
 * crxjs builds the content script in a build of its own (an IIFE, `vite.config.ts`), whose modules
 * the watching build never sees, so an edit to the HUD or the edge light rebuilt nothing. Each
 * build follows the content script's imports, with the build's own resolution (workspace packages
 * included, dependencies under `node_modules` left out), and watches every file it reaches.
 */
function watchContentScript(entry: string): Plugin {
  let root = '';
  return {
    name: 'atd:watch-content-script',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      if (!this.meta.watchMode) return;
      const seen = new Set<string>();
      const visit = async (file: string): Promise<void> => {
        if (seen.has(file)) return;
        seen.add(file);
        this.addWatchFile(file);
        if (!SCRIPT.test(file)) return;
        const code = await readFile(file, 'utf8');
        const program = this.parse(code, { lang: file.endsWith('x') ? 'tsx' : 'ts' });
        const sources = program.body.flatMap((node) =>
          'source' in node && node.source ? [String(node.source.value)] : [],
        );
        await Promise.all(
          sources.map(async (source) => {
            const resolved = await this.resolve(source, file);
            const path = resolved?.external ? undefined : resolved?.id.split('?')[0];
            if (!path || path.startsWith('\0') || path.includes('/node_modules/')) return;
            await visit(path);
          }),
        );
      };
      await visit(resolve(root, entry));
    },
  };
}

/**
 * A new stamp once each dev build has written its files, the content script's IIFE included (crxjs
 * emits it with the main build), so the extension reloading on it never loads a half-written build
 * (`src/dev-build.ts`).
 */
function devBuildStamp(): Plugin {
  let outDir = '';
  return {
    name: 'atd:dev-build-stamp',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      const stamp: DevBuild = { build: `${Date.now()}` };
      await writeFile(resolve(outDir, DEV_BUILD_FILE), JSON.stringify(stamp));
    },
  };
}
