import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Start with the entire checkout. In particular all workflow definitions, packaging scripts,
// workspace manifests, lockfiles and patches participate in both keys. Keep this projection
// identical for local Git and GitHub's tree of the historical producer.
function isInput(kind, path) {
  if (path.startsWith('apps/desktop/src/'))
    return kind === 'native' && path.startsWith('apps/desktop/src/native-bridge/');
  if (path.startsWith('apps/website/')) return path === 'apps/website/package.json';
  if (kind === 'native') {
    if (path.startsWith('apps/agent-service/')) return path === 'apps/agent-service/package.json';
    return !path.startsWith('crates/');
  }
  return !/^apps\/macos\/(App|FinderSync|Sources|Tests|Widgets)\//.test(path);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const validSha = (value) => /^[0-9a-f]{40}$/.test(value);

export function sourceHash(kind, entries) {
  const records = [];
  for (const { mode, path, sha, type } of entries) {
    if (typeof path !== 'string' || !validSha(sha)) throw new Error('Invalid Git tree entry.');
    if (type === 'tree' || !isInput(kind, path)) continue;
    if (
      !['blob', 'commit'].includes(type) ||
      !['100644', '100755', '120000', '160000'].includes(mode)
    )
      throw new Error('Unsupported Git tree mode or type.');
    records.push(JSON.stringify([path, mode, sha]));
  }
  if (!records.length) throw new Error('Empty component source tree.');
  return sha256(records.sort().join('\n'));
}

export function localSourceHash(kind, tree) {
  const bytes = execFileSync('git', ['ls-tree', '--full-tree', '-rz', tree], {
    maxBuffer: 64 * 1024 ** 2,
  });
  const records = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0');
  return sourceHash(
    kind,
    records.filter(Boolean).map((record) => {
      const tab = record.indexOf('\t');
      const [mode, type, sha] = record.slice(0, tab).split(' ');
      return { mode, type, sha, path: record.slice(tab + 1) };
    }),
  );
}

function version(program, ...args) {
  const value = execFileSync(program, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!value) throw new Error(`Could not identify ${program}.`);
  return value;
}

export function componentKey(kind, source, hosted) {
  const env = process.env;
  if (
    !['arm64', 'x64'].includes(env.RELEASE_ARCH) ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(env.VERSION ?? '') ||
    !/^\d+(?:\.[0-9A-Za-z]+)+$/.test(env.BUILD_VERSION ?? '')
  )
    throw new Error('Set RELEASE_ARCH, VERSION and the dash-free BUILD_VERSION.');
  if (
    hosted &&
    (env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      env.RUNNER_OS !== 'macOS' ||
      env.RUNNER_ARCH?.toLowerCase() !== env.RELEASE_ARCH ||
      process.arch !== env.RELEASE_ARCH ||
      !env.ImageOS ||
      !env.ImageVersion)
  )
    throw new Error(
      'Component preparation needs the target GitHub-hosted Mac and its image identity.',
    );
  const identity = {
    schema: 1,
    kind,
    source,
    arch: env.RELEASE_ARCH,
    version: env.VERSION,
    build: env.BUILD_VERSION,
    platform: process.platform,
    nodeArch: process.arch,
    node: process.version,
    pnpm: version('pnpm', '--version'),
    image: [env.ImageOS ?? 'local', env.ImageVersion ?? 'local'],
    macos: version('sw_vers', '-buildVersion'),
    xcode: version('xcodebuild', '-version'),
    sdk: version('xcrun', '--sdk', 'macosx', '--show-sdk-build-version'),
    clang: version('xcrun', 'clang', '--version'),
    tools:
      kind === 'native'
        ? {
            swift: version('xcrun', 'swiftc', '--version'),
            xcodegen: version('xcodegen', '--version'),
          }
        : { rustc: version('rustc', '-vV'), cargo: version('cargo', '-Vv') },
  };
  return sha256(JSON.stringify(identity));
}
