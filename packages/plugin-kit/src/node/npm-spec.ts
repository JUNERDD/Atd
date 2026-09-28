import { createHash, timingSafeEqual } from 'node:crypto';

/** A parsed npm source spec: an exact version or a dist-tag, never a range. */
export interface NpmSpec {
  name: string;
  selector: { type: 'version'; value: string } | { type: 'tag'; value: string };
}

const NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** Dist-tags start with a letter; `x`/`X` alone is a wildcard range, not a tag. */
const TAG = /^[A-Za-z][A-Za-z0-9._-]*$/;

/** Parses `name`, `name@1.2.3`, `name@tag` or `@scope/name@…`. Ranges are rejected. */
export function parseNpmSpec(spec: string): NpmSpec {
  const trimmed = spec.trim();
  const at = trimmed.indexOf('@', trimmed.startsWith('@') ? 1 : 0);
  const name = at === -1 ? trimmed : trimmed.slice(0, at);
  const selector = at === -1 ? 'latest' : trimmed.slice(at + 1);
  if (!NAME.test(name) || name.length > 214) {
    throw new Error(`"${name}" is not a valid npm package name.`);
  }
  if (EXACT_VERSION.test(selector)) return { name, selector: { type: 'version', value: selector } };
  if (TAG.test(selector) && selector.toLowerCase() !== 'x') {
    return { name, selector: { type: 'tag', value: selector } };
  }
  throw new Error(
    `"${spec}" uses a version range or an unsupported spec; give an exact version (name@1.2.3) or a dist-tag (name@latest).`,
  );
}

/** Registry URL of a package's packument; the scope separator is encoded (`@scope%2fname`). */
export function packumentUrl(registry: string, name: string): string {
  return `${registry.replace(/\/+$/, '')}/${name.replace('/', '%2f')}`;
}

const SRI_ALGORITHMS = ['sha512', 'sha384', 'sha256'] as const;

/** Result of checking a tarball: the integrity string to record and any weakness to report. */
export interface IntegrityCheck {
  integrity: string;
  warning?: string;
}

/**
 * Verifies `data` against the packument's `dist`. SRI `integrity` wins (strongest supported
 * algorithm); a legacy `shasum` alone is verified as SHA-1 and reported as weak.
 */
export function verifyIntegrity(
  data: Uint8Array,
  dist: { integrity?: string; shasum?: string },
): IntegrityCheck {
  const entries = (dist.integrity ?? '')
    .split(/\s+/)
    .map((token) => {
      const dash = token.indexOf('-');
      return { algorithm: token.slice(0, dash), digest: token.slice(dash + 1).split('?')[0] ?? '' };
    })
    .filter((entry) => entry.digest !== '');
  for (const algorithm of SRI_ALGORITHMS) {
    const expected = entries.filter((entry) => entry.algorithm === algorithm);
    if (expected.length === 0) continue;
    const actual = createHash(algorithm).update(data).digest();
    const matches = expected.some((entry) => {
      const digest = Buffer.from(entry.digest, 'base64');
      return digest.length === actual.length && timingSafeEqual(digest, actual);
    });
    if (!matches) throw new Error(`The npm tarball does not match its ${algorithm} integrity.`);
    return { integrity: `${algorithm}-${actual.toString('base64')}` };
  }
  if (dist.shasum !== undefined && /^[0-9a-f]{40}$/i.test(dist.shasum)) {
    const actual = createHash('sha1').update(data).digest();
    if (actual.toString('hex') !== dist.shasum.toLowerCase()) {
      throw new Error('The npm tarball does not match its sha1 shasum.');
    }
    return {
      integrity: `sha1-${actual.toString('base64')}`,
      warning: 'The npm registry only published a SHA-1 checksum for this tarball.',
    };
  }
  throw new Error('The npm registry published no usable integrity for this tarball.');
}
