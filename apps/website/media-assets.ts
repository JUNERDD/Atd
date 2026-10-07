import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

const virtualId = 'virtual:atd-media';
const resolvedId = '\0' + virtualId;

/** Only raster images and videos in cases/ and summon/ leave the application host. */
export function isHostedAsset(filename: string) {
  return /^assets\/media\/(?:cases|summon)\//.test(filename);
}

export function normalizeAssetBase(value: string | undefined) {
  if (!value?.trim()) return '';
  const url = new URL(value.trim());
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('VITE_ASSET_BASE_URL must be an HTTP(S) URL without credentials or query.');
  return url.href.replace(/\/$/, '') + '/';
}

export function websiteMediaAssets(assetBase: string): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'atd-media-assets',
    configResolved(resolved) {
      config = resolved;
    },
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      const directory = join(config.root, 'public');
      const urls: Record<string, string> = {};
      const visit = (prefix = '') => {
        for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
          const name = posix.join(prefix, entry.name);
          if (entry.isDirectory()) {
            if (prefix || ['cases', 'summon'].includes(name)) visit(name);
            continue;
          }
          if (!/^(?:cases|summon)\/.*\.(?:mp4|jpe?g|png|webp)$/.test(name)) continue;
          const sourcePath = join(directory, name);
          this.addWatchFile(sourcePath);
          if (config.command === 'serve') {
            urls[name] = config.base + name;
            continue;
          }
          const source = readFileSync(sourcePath);
          const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
          const extension = posix.extname(name);
          const fileName = `assets/media/${name.slice(0, -extension.length)}-${hash}${extension}`;
          urls[name] = (assetBase || config.base) + fileName;
          // Both SSR and client resolve to the same content address. Emit only once.
          if (this.environment.config.consumer === 'client')
            this.emitFile({ type: 'asset', fileName, source });
        }
      };
      visit();
      return `export default ${JSON.stringify(urls)};`;
    },
    closeBundle() {
      if (this.environment.config.consumer !== 'client' || config.command !== 'build') return;
      // Vite copies public verbatim; only content-addressed media should ship.
      for (const directory of ['cases', 'summon'])
        rmSync(join(config.root, config.build.outDir, directory), { recursive: true, force: true });
    },
    generateBundle(_options, bundle) {
      if (this.environment.config.consumer !== 'client') return;
      const assets = Object.values(bundle)
        .filter((asset) => asset.type === 'asset' && isHostedAsset(asset.fileName))
        .map((asset) => {
          if (asset.type !== 'asset') throw new Error('Expected a content asset');
          const bytes = Buffer.from(asset.source);
          const contentType = asset.fileName.endsWith('.mp4')
            ? 'video/mp4'
            : asset.fileName.endsWith('.png')
              ? 'image/png'
              : asset.fileName.endsWith('.webp')
                ? 'image/webp'
                : 'image/jpeg';
          return {
            key: asset.fileName,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            contentType,
            cacheControl: 'public, max-age=31536000, immutable',
          };
        })
        .sort((a, b) => a.key.localeCompare(b.key));
      this.emitFile({
        type: 'asset',
        fileName: 'asset-manifest.json',
        source: JSON.stringify({ version: 1, assets }, null, 2) + '\n',
      });
    },
  };
}
