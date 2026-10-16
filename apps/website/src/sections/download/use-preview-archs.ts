import { useEffect, useState } from 'react';
import { site, type Download } from '../../content/site';

type Arch = Download['arch'];

/**
 * `x.y.z` or `x.y.z-rc.n`, the only versions the release channels serve, as a tuple that sorts by
 * release order: a stable release sorts after each of its candidates. Anything else is `null`.
 */
function parseVersion(version: unknown): number[] | null {
  if (typeof version !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version);
  if (!match) return null;
  const [, major, minor, patch, candidate] = match;
  return [
    Number(major),
    Number(minor),
    Number(patch),
    candidate === undefined ? Infinity : Number(candidate),
  ];
}

function isNewer(version: number[], than: number[]): boolean {
  for (const [index, part] of version.entries()) {
    const other = than[index] ?? 0;
    if (part !== other) return part > other;
  }
  return false;
}

/** The version the rc manifest lists for one architecture, unchecked. */
function archVersion(manifest: unknown, arch: Arch): unknown {
  if (typeof manifest !== 'object' || manifest === null || !('architectures' in manifest)) return;
  const { architectures } = manifest;
  if (typeof architectures !== 'object' || architectures === null) return;
  const entry: unknown = Reflect.get(architectures, arch);
  if (typeof entry !== 'object' || entry === null || !('version' in entry)) return;
  return entry.version;
}

/**
 * The chip families whose preview build is newer than the stable version the page describes, read
 * from the rc channel's manifest once the page runs. The set stays empty in the prerendered markup,
 * while the manifest loads, when it can't be read, and whenever the channel serves the stable
 * release or an older candidate, so a preview link never offers a build behind the stable one.
 */
export function usePreviewArchs(): ReadonlySet<Arch> {
  const [archs, setArchs] = useState<ReadonlySet<Arch>>(() => new Set());

  useEffect(() => {
    const stable = parseVersion(site.version);
    if (!stable) return;
    const controller = new AbortController();
    fetch(site.previewManifestUrl, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest: unknown) => {
        const newer = site.downloads.filter((download) => {
          const version = parseVersion(archVersion(manifest, download.arch));
          return version !== null && isNewer(version, stable);
        });
        setArchs(new Set(newer.map((download) => download.arch)));
      })
      // An aborted, failed or malformed read leaves the preview hidden.
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return archs;
}
