export const DEBUG_MANIFEST_URL = '/downloads/debug.json';
const DOWNLOAD_ORIGIN = 'https://downloads.atd.best';
export const DEBUG_ARCHES = ['arm64', 'x64'] as const;
export type DebugArch = (typeof DEBUG_ARCHES)[number];

export interface DebugDownload {
  arch: DebugArch;
  url: string;
  sha256: string;
  bytes: number;
  minMacOS: string;
}

export interface DebugBuild {
  version: string;
  profile: 'runtime' | 'focus';
  publishedAt: string;
  downloads: DebugDownload[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only verified debug-channel URLs are offered; malformed data never becomes a download link. */
export function parseDebugManifest(value: unknown): DebugBuild {
  if (!isRecord(value)) throw new Error('Invalid diagnostic manifest.');
  const { version, buildVersion, revision, profile, publishedAt, architectures } = value;
  if (
    value.schemaVersion !== 1 ||
    value.channel !== 'debug' ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+-[A-Za-z][0-9A-Za-z.-]*$/.test(version) ||
    typeof buildVersion !== 'string' ||
    !/^\d+\.\d+\.\d+[A-Za-z][0-9A-Za-z.]*$/.test(buildVersion) ||
    typeof revision !== 'string' ||
    !/^[a-f0-9]{40}$/.test(revision) ||
    (profile !== 'runtime' && profile !== 'focus') ||
    typeof publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    !isRecord(architectures) ||
    Object.keys(architectures).some((arch) => arch !== 'arm64' && arch !== 'x64')
  )
    throw new Error('Invalid diagnostic manifest.');
  const downloads: DebugDownload[] = [];
  for (const arch of DEBUG_ARCHES) {
    if (!(arch in architectures)) continue;
    const entry = architectures[arch];
    if (!isRecord(entry)) throw new Error('Invalid diagnostic download.');
    const expected = `${DOWNLOAD_ORIGIN}/debug/builds/${revision}/${version}/Atd-${version}-${arch}.dmg`;
    if (
      entry.url !== expected ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      typeof entry.bytes !== 'number' ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      entry.bytes > 512 * 1024 ** 2 ||
      typeof entry.minMacOS !== 'string' ||
      !/^\d+(?:\.\d+){0,2}$/.test(entry.minMacOS)
    )
      throw new Error('Invalid diagnostic download.');
    downloads.push({
      arch,
      url: expected,
      sha256: entry.sha256,
      bytes: entry.bytes,
      minMacOS: entry.minMacOS,
    });
  }
  if (downloads.length === 0) throw new Error('No diagnostic installers.');
  return { version, profile, publishedAt, downloads };
}
