/** Enable native task caching only for a known local development compiler context. */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nativeTaskName = '@atd/file-index#build';

/** Derive the dev configuration from the production task graph without changing its edges. */
export async function prepareDevNativeCache() {
  const sourcePath = path.join(repository, 'turbo.json');
  try {
    const source = await readFile(sourcePath, 'utf8');
    const config = JSON.parse(source);
    const task = config.tasks?.[nativeTaskName];
    if (
      !task ||
      typeof task !== 'object' ||
      !Array.isArray(task.inputs) ||
      !task.inputs.every((input) => typeof input === 'string')
    ) {
      throw new Error('The native build task does not declare its inputs.');
    }

    const context = await nativeContext();
    if (!context.enabled) bypass(context.reason);
    const digest = createHash('sha256')
      .update(source)
      .update(JSON.stringify(context))
      .digest('hex');
    const relativeDirectory = `.turbo/dev/${digest}`;
    const directory = path.join(repository, relativeDirectory);
    const contextInput = `$TURBO_ROOT$/${relativeDirectory}/native-context.json`;
    config.tasks[nativeTaskName] = {
      ...task,
      cache: context.enabled,
      inputs: [
        ...new Set([...task.inputs, contextInput, '$TURBO_ROOT$/scripts/dev-native-cache.mjs']),
      ],
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeAtomic(path.join(directory, 'native-context.json'), context);
    const generatedPath = path.join(directory, 'turbo.json');
    await writeAtomic(generatedPath, config);
    return generatedPath;
  } catch {
    // The checked-in configuration keeps this task uncached; preparation must not block dev.
    bypass('development cache preparation failed');
    return sourcePath;
  }
}

async function nativeContext() {
  const base = {
    version: 1,
    checkout: await realpath(repository),
    node: {
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      executable: await realpath(process.execPath),
    },
  };
  const disabled = (reason) => ({ ...base, enabled: false, reason });
  if (process.platform !== 'darwin') return disabled('native caching is macOS-only');
  if (!['arm64', 'x64'].includes(process.arch)) return disabled('unsupported Node architecture');
  if (Object.keys(process.env).some(isCompilerOverride))
    return disabled('custom compiler environment');

  const cwd = await realpath(path.join(repository, 'packages/file-index'));
  try {
    if (await hasCargoConfig(cwd)) return disabled('custom Cargo configuration');
  } catch {
    return disabled('Cargo configuration could not be checked');
  }

  const commands = [
    ['rustc', ['-vV']],
    ['cargo', ['-V']],
    ['xcrun', ['--show-sdk-path']],
    ['xcrun', ['--show-sdk-version']],
    ['xcrun', ['clang', '--version']],
  ];
  const cachedTools = await readCachedTools(cwd);
  if (cachedTools) {
    return {
      ...base,
      enabled: true,
      tools: cachedTools,
    };
  }
  const [identities, probes] = await Promise.all([
    Promise.allSettled(
      commands.map(async ([command, args]) => {
        const { stdout } = await exec(command, args, {
          cwd,
          encoding: 'utf8',
          timeout: 3000,
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024,
        });
        if (!stdout.trim()) throw new Error('Missing tool identity.');
        return { command, args, identity: stdout.trim() };
      }),
    ),
    probeToolPaths(cwd),
  ]);
  if (identities.some((result) => result.status === 'rejected'))
    return disabled('compiler or SDK identity is unavailable');
  const tools = identities.map((result) => result.value);
  await writeCachedTools(tools, probes).catch(() => {});
  return {
    ...base,
    enabled: true,
    tools,
  };
}

const TOOLCHAIN_CACHE_VERSION = 1;
const toolchainCacheFile = path.join(repository, '.turbo/dev/native-tools-cache.json');

async function statStamp(filePath) {
  const stat = await lstat(filePath, { bigint: true });
  return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

async function resolveOnPath(name) {
  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of entries) {
    const candidate = path.join(dir, name);
    try {
      const stat = await lstat(candidate);
      if (stat.isFile() || stat.isSymbolicLink()) return await realpath(candidate);
    } catch {
      // keep searching
    }
  }
  return null;
}

async function probeToolPaths(cwd) {
  const run = async (command, args) => {
    try {
      const { stdout } = await exec(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: 3000,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  };
  const [rustcPath, cargoPath, sysroot, developerDir, clangPath] = await Promise.all([
    resolveOnPath('rustc'),
    resolveOnPath('cargo'),
    run('rustc', ['--print', 'sysroot']),
    run('xcode-select', ['-p']),
    run('xcrun', ['--find', 'clang']),
  ]);
  return { rustcPath, cargoPath, sysroot, developerDir, clangPath };
}

async function readCachedTools(cwd) {
  try {
    const cached = JSON.parse(await readFile(toolchainCacheFile, 'utf8'));
    if (cached?.version !== TOOLCHAIN_CACHE_VERSION || cached.pathEnv !== (process.env.PATH ?? ''))
      return null;
    if (!Array.isArray(cached.tools) || !Array.isArray(cached.watched) || !cached.developerDir)
      return null;
    const { stdout: currentDevDir } = await exec('xcode-select', ['-p'], {
      cwd,
      encoding: 'utf8',
      timeout: 2000,
    });
    if (currentDevDir.trim() !== cached.developerDir) return null;
    const checks = await Promise.all(
      cached.watched.map(async ([file, expected]) => (await statStamp(file)) === expected),
    );
    return checks.every(Boolean) ? cached.tools : null;
  } catch {
    return null;
  }
}

async function writeCachedTools(tools, probes) {
  const sdkPath = tools.find(
    (t) => t.command === 'xcrun' && t.args[0] === '--show-sdk-path',
  )?.identity;
  if (!probes.rustcPath || !probes.cargoPath || !probes.sysroot || !probes.developerDir || !sdkPath)
    return;
  const watchFiles = [
    path.join(repository, 'rust-toolchain.toml'),
    probes.rustcPath,
    probes.cargoPath,
    path.join(probes.sysroot, 'bin/rustc'),
    path.join(probes.sysroot, 'bin/cargo'),
    '/usr/bin/xcrun',
    path.join(sdkPath, 'SDKSettings.plist'),
    ...(probes.clangPath ? [probes.clangPath] : []),
  ];
  const watched = await Promise.all(
    [...new Set(watchFiles)].map(async (file) => [file, await statStamp(file)]),
  );
  await mkdir(path.dirname(toolchainCacheFile), { recursive: true, mode: 0o700 });
  await writeAtomic(toolchainCacheFile, {
    version: TOOLCHAIN_CACHE_VERSION,
    pathEnv: process.env.PATH ?? '',
    developerDir: probes.developerDir,
    watched,
    tools,
  });
}

function isCompilerOverride(name) {
  return (
    name === 'CARGO' ||
    name.startsWith('CARGO_') ||
    /^(RUSTC(?:_|$)|RUSTFLAGS$|RUSTDOC(?:_|$)|RUSTDOCFLAGS$|RUSTUP_TOOLCHAIN$|RUST_TARGET_PATH$)/.test(
      name,
    ) ||
    /^(CC|CXX|CPP|AR|LD|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS)(_|$)/.test(name) ||
    /^(HOST|TARGET)_(CC|CXX|CPP|AR|LD|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS)(_|$)/.test(name) ||
    /^(SDKROOT|DEVELOPER_DIR|TOOLCHAINS|MACOSX_DEPLOYMENT_TARGET)$/.test(name) ||
    /^NAPI_(FORCE_BUILD_|TYPE_DEF_)/.test(name)
  );
}

async function hasCargoConfig(cwd) {
  const directories = new Set();
  for (let current = cwd; ; current = path.dirname(current)) {
    directories.add(path.join(current, '.cargo'));
    if (path.dirname(current) === current) break;
  }
  directories.add(process.env.CARGO_HOME || path.join(homedir(), '.cargo'));
  const checks = await Promise.all(
    [...directories].flatMap((directory) =>
      ['config', 'config.toml'].map(async (name) => {
        try {
          await lstat(path.join(directory, name));
          return true;
        } catch (error) {
          if (error.code === 'ENOENT') return false;
          throw error;
        }
      }),
    ),
  );
  return checks.some(Boolean);
}

async function writeAtomic(file, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if ((await readFile(file, 'utf8')) === content) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

function bypass(reason) {
  process.stderr.write(`[dev] Native build cache disabled: ${reason}.\n`);
}
