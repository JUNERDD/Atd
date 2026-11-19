/** A local receipt for successful Debug builds and their separately signed, registered copies. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { nativeHostArch } from './arch.mjs';
import { createCodegenCache } from './dev-codegen-cache.mjs';
import {
  isNativeOutput,
  nativeBuildScripts,
  nativeDirectories,
  nativeRootFiles,
} from './dev-inputs.mjs';

const run = promisify(execFile);
const VERSION = 2;

export function devCachePath(packageRoot) {
  return path.join(packageRoot, 'DerivedData', 'dev-app-receipt.json');
}

function readDevReceipt(receiptPath) {
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    return receipt.version === VERSION ? receipt : null;
  } catch {
    return null;
  }
}

function writeDevReceipt(receiptPath, receipt) {
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  const temporary = `${receiptPath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: VERSION, ...receipt }));
  renameSync(temporary, receiptPath);
}

/** A direct Debug build invalidates the binary, not an independently verified bridge graph. */
export function invalidateDevBuild(packageRoot) {
  const receiptPath = devCachePath(packageRoot);
  writeDevReceipt(receiptPath, { codegen: readDevReceipt(receiptPath)?.codegen });
}

export async function createDevCache({ packageRoot, builtApp, installedApp, signal, log }) {
  const receiptPath = devCachePath(packageRoot);
  const contextReady = buildContext(packageRoot, signal).catch((error) => {
    // An unknown tool/configuration must never let a stale binary pass as up to date.
    log(`Native build reuse disabled: ${error.message}`);
    return undefined;
  });

  const readReceipt = () => readDevReceipt(receiptPath);
  const writeReceipt = (receipt) => {
    try {
      writeDevReceipt(receiptPath, receipt);
    } catch (error) {
      log(`Could not save native build receipt: ${error.message}`);
    }
  };
  const buildStamp = () => {
    try {
      // Also detects builds invoked directly in Xcode, which register the DerivedData copy even
      // when no bundle bytes change. In that case only the installed copy needs refreshing.
      const stat = lstatSync(
        path.join(packageRoot, 'DerivedData/Build/Intermediates.noindex/XCBuildData/build.db'),
        { bigint: true },
      );
      return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    } catch {
      return null;
    }
  };

  const codegen = await createCodegenCache({
    packageRoot,
    buildContext: contextReady,
    signal,
    log,
    read: readReceipt,
    write: writeReceipt,
  });
  const context = await contextReady;
  const nativeInputNames = [
    ...nativeDirectories,
    ...nativeRootFiles,
    ...nativeBuildScripts.map((script) => `scripts/${script}`),
    // Changes to receipt/install policy require a fresh validated installation.
    'scripts/dev-cache.mjs',
    'scripts/dev-inputs.mjs',
    'scripts/dev-install.mjs',
  ];
  // In-process stat snapshot of the last cryptographically verified inputs and bundles so
  // post-readiness re-checks avoid re-reading 270MB of unchanged .app bundles seconds later.
  let lastInputs = null;
  let verified = null;

  const computeInputs = () => {
    const hash = createHash('sha256').update(JSON.stringify(context ?? null));
    const stamp = createHash('sha256');
    for (const name of nativeInputNames) {
      hashTree(hash, packageRoot, name, isNativeOutput, stamp);
    }
    const content = hash.digest('hex');
    lastInputs = { content, stamp: stamp.digest('hex') };
    return content;
  };
  const inputsStatStamp = () => {
    try {
      const stamp = createHash('sha256');
      for (const name of nativeInputNames) {
        statTree(stamp, packageRoot, name, isNativeOutput);
      }
      return stamp.digest('hex');
    } catch {
      return null;
    }
  };
  const lookupFull = (inputs) => {
    const receipt = readReceipt();
    if (!context || receipt?.inputs !== inputs || !receipt.built) {
      verified = null;
      return { built: false, installed: false };
    }
    const builtInfo = bundleDigestWithStamp(builtApp);
    if (!builtInfo || receipt.built !== builtInfo.digest) {
      verified = null;
      return { built: false, installed: false };
    }
    const currentBuildStamp = buildStamp();
    let installedInfo = null;
    const installed = Boolean(
      receipt.installed &&
      receipt.buildStamp &&
      receipt.buildStamp === currentBuildStamp &&
      (installedInfo = bundleDigestWithStamp(installedApp)) &&
      receipt.installed === installedInfo.digest,
    );
    verified = {
      inputs,
      builtStamp: builtInfo.stamp,
      buildStamp: currentBuildStamp,
      installed,
      installedStamp: installed ? installedInfo.stamp : null,
    };
    return { built: true, installed };
  };

  return {
    codegen,
    inputs: computeInputs,
    lookup: lookupFull,
    reverify(inputs) {
      const inputsCurrent =
        (lastInputs?.content === inputs && inputsStatStamp() === lastInputs.stamp) ||
        computeInputs() === inputs;
      if (!inputsCurrent) return { inputsCurrent: false, built: false, installed: false };
      if (verified?.inputs === inputs) {
        const builtStamp = bundleStatStamp(builtApp);
        if (builtStamp && builtStamp === verified.builtStamp) {
          if (verified.installed) {
            const currentBuildStamp = buildStamp();
            const installedStamp = bundleStatStamp(installedApp);
            if (
              verified.buildStamp &&
              verified.buildStamp === currentBuildStamp &&
              installedStamp &&
              installedStamp === verified.installedStamp
            ) {
              return { inputsCurrent: true, built: true, installed: true };
            }
          } else {
            return { inputsCurrent: true, built: true, installed: false };
          }
        }
      }
      return { inputsCurrent: true, ...lookupFull(inputs) };
    },
    invalidate() {
      verified = null;
      writeReceipt({ codegen: readReceipt()?.codegen });
    },
    recordBuild(inputs) {
      if (!context) return;
      const builtInfo = bundleDigestWithStamp(builtApp);
      if (builtInfo) {
        const currentBuildStamp = buildStamp();
        writeReceipt({
          codegen: readReceipt()?.codegen,
          inputs,
          built: builtInfo.digest,
          buildStamp: currentBuildStamp,
          installed: null,
        });
        verified = {
          inputs,
          builtStamp: builtInfo.stamp,
          buildStamp: currentBuildStamp,
          installed: false,
          installedStamp: null,
        };
      }
    },
    recordInstall(inputs) {
      const receipt = readReceipt();
      if (receipt?.inputs !== inputs) return;
      const builtMatches =
        (verified?.inputs === inputs &&
          verified.builtStamp &&
          bundleStatStamp(builtApp) === verified.builtStamp) ||
        receipt.built === bundleDigest(builtApp);
      if (!builtMatches) return;
      const installedInfo = bundleDigestWithStamp(installedApp);
      if (installedInfo) {
        const currentBuildStamp = buildStamp();
        writeReceipt({
          ...receipt,
          buildStamp: currentBuildStamp,
          installed: installedInfo.digest,
        });
        if (verified?.inputs === inputs) {
          verified = {
            ...verified,
            buildStamp: currentBuildStamp,
            installed: true,
            installedStamp: installedInfo.stamp,
          };
        }
      }
    },
  };
}

async function buildContext(packageRoot, signal) {
  // These overrides can reference additional config files or arbitrary compiler scripts. Let
  // Xcode resolve them instead of guessing their transitive inputs for a cache hit.
  for (const name of ['XCODE_XCCONFIG_FILE', 'SWIFT_EXEC', 'CC', 'CXX', 'LD']) {
    if (process.env[name]) throw new Error(`${name} overrides the standard build toolchain.`);
  }
  const commands = [
    ['xcode-select', ['-p']],
    ['xcodebuild', ['-version']],
    ['xcrun', ['--find', 'swiftc']],
    ['xcrun', ['swift', '--version']],
    ['xcrun', ['--show-sdk-path']],
    ['xcrun', ['--show-sdk-version']],
    ['which', ['xcodegen']],
    ['xcodegen', ['--version']],
  ];
  if (process.env.AI_CODE_SIGN_IDENTITY?.trim() && process.env.AI_CODE_SIGN_IDENTITY !== '-') {
    const keychain = process.env.AI_SIGNING_KEYCHAIN?.trim();
    commands.push([
      'security',
      ['find-identity', '-p', 'codesigning', ...(keychain ? [keychain] : [])],
    ]);
  }
  const tools = await Promise.all(
    commands.map(async ([command, args]) => {
      const { stdout } = await run(command, args, { encoding: 'utf8', signal, timeout: 5000 });
      return [command, args, stdout.trim()];
    }),
  );
  return {
    // Debug EngineBinaries embeds #filePath, so identical sources in another checkout differ.
    root: realpathSync(packageRoot),
    configuration: 'Debug',
    arch: nativeHostArch(),
    environment: Object.fromEntries(
      [
        'AI_CODE_SIGN_IDENTITY',
        'AI_DEVELOPMENT_TEAM',
        'AI_SIGNING_KEYCHAIN',
        'DEVELOPER_DIR',
        'TOOLCHAINS',
        'SDKROOT',
      ].map((name) => [name, process.env[name] ?? null]),
    ),
    tools,
  };
}

function bundleDigest(bundle) {
  return bundleDigestWithStamp(bundle)?.digest ?? null;
}

function bundleDigestWithStamp(bundle) {
  try {
    const executable = lstatSync(path.join(bundle, 'Contents/MacOS/Atd'));
    if (!executable.isFile() || !(executable.mode & 0o111)) return null;
    const hash = createHash('sha256');
    const stamp = createHash('sha256');
    hashTree(hash, bundle, '', () => false, stamp);
    // Replacement with identical bytes still needs registration/indexing. Ignore ctime: macOS
    // updates bundle extended attributes after first launch without changing signed contents.
    const stat = lstatSync(bundle, { bigint: true });
    hash.update(String(stat.ino));
    stamp.update(String(stat.ino));
    return { digest: hash.digest('hex'), stamp: stamp.digest('hex') };
  } catch {
    return null;
  }
}

function bundleStatStamp(bundle) {
  try {
    const executable = lstatSync(path.join(bundle, 'Contents/MacOS/Atd'));
    if (!executable.isFile() || !(executable.mode & 0o111)) return null;
    const stamp = createHash('sha256');
    statTree(stamp, bundle, '', () => false);
    const stat = lstatSync(bundle, { bigint: true });
    stamp.update(String(stat.ino));
    return stamp.digest('hex');
  } catch {
    return null;
  }
}

function hashTree(hash, root, name, ignore, stamp) {
  if (ignore(name)) return;
  const file = path.join(root, name);
  const stat = lstatSync(file, { bigint: true });
  hash.update(JSON.stringify([name, Number(stat.mode)]));
  if (stat.isSymbolicLink()) {
    // Framework symlinks point to entries included elsewhere in the same bundle tree.
    const link = readlinkSync(file);
    hash.update(JSON.stringify(link));
    stamp?.update(`l:${name}:${stat.mode}:${stat.ino}:${stat.mtimeNs}:${link}\0`);
  } else if (stat.isDirectory()) {
    stamp?.update(`d:${name}:${stat.mode}:${stat.ino}:${stat.mtimeNs}\0`);
    for (const child of readdirSync(file).sort())
      hashTree(hash, root, path.join(name, child), ignore, stamp);
  } else if (stat.isFile()) {
    hash.update(String(stat.size)).update('\0').update(readFileSync(file));
    stamp?.update(`f:${name}:${stat.mode}:${stat.ino}:${stat.size}:${stat.mtimeNs}\0`);
  } else {
    throw new Error(`Unsupported native input: ${name}`);
  }
}

function statTree(stamp, root, name, ignore) {
  if (ignore(name)) return;
  const file = path.join(root, name);
  const stat = lstatSync(file, { bigint: true });
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(file);
    stamp.update(`l:${name}:${stat.mode}:${stat.ino}:${stat.mtimeNs}:${link}\0`);
  } else if (stat.isDirectory()) {
    stamp.update(`d:${name}:${stat.mode}:${stat.ino}:${stat.mtimeNs}\0`);
    for (const child of readdirSync(file).sort())
      statTree(stamp, root, path.join(name, child), ignore);
  } else if (stat.isFile()) {
    stamp.update(`f:${name}:${stat.mode}:${stat.ino}:${stat.size}:${stat.mtimeNs}\0`);
  } else {
    throw new Error(`Unsupported native input: ${name}`);
  }
}
