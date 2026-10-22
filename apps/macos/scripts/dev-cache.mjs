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
  return {
    codegen,
    inputs() {
      const hash = createHash('sha256').update(JSON.stringify(context ?? null));
      for (const name of [
        ...nativeDirectories,
        ...nativeRootFiles,
        ...nativeBuildScripts.map((script) => `scripts/${script}`),
        // Changes to receipt/install policy require a fresh validated installation.
        'scripts/dev-cache.mjs',
        'scripts/dev-inputs.mjs',
        'scripts/dev-install.mjs',
      ]) {
        hashTree(hash, packageRoot, name, isNativeOutput);
      }
      return hash.digest('hex');
    },
    lookup(inputs) {
      const receipt = readReceipt();
      if (
        !context ||
        receipt?.inputs !== inputs ||
        !receipt.built ||
        receipt.built !== bundleDigest(builtApp)
      )
        return { built: false, installed: false };
      return {
        built: true,
        installed: Boolean(
          receipt.installed &&
          receipt.buildStamp &&
          receipt.buildStamp === buildStamp() &&
          receipt.installed === bundleDigest(installedApp),
        ),
      };
    },
    invalidate() {
      writeReceipt({ codegen: readReceipt()?.codegen });
    },
    recordBuild(inputs) {
      if (!context) return;
      const built = bundleDigest(builtApp);
      if (built)
        writeReceipt({
          codegen: readReceipt()?.codegen,
          inputs,
          built,
          buildStamp: buildStamp(),
          installed: null,
        });
    },
    recordInstall(inputs) {
      const receipt = readReceipt();
      if (receipt?.inputs !== inputs || receipt.built !== bundleDigest(builtApp)) return;
      const installed = bundleDigest(installedApp);
      if (installed) writeReceipt({ ...receipt, buildStamp: buildStamp(), installed });
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
  if (process.env.AI_CODE_SIGN_IDENTITY?.trim() && process.env.AI_CODE_SIGN_IDENTITY !== '-')
    commands.push(['security', ['find-identity', '-v', '-p', 'codesigning']]);
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
        'DEVELOPER_DIR',
        'TOOLCHAINS',
        'SDKROOT',
      ].map((name) => [name, process.env[name] ?? null]),
    ),
    tools,
  };
}

function bundleDigest(bundle) {
  try {
    const executable = lstatSync(path.join(bundle, 'Contents/MacOS/Atd'));
    if (!executable.isFile() || !(executable.mode & 0o111)) return null;
    const hash = createHash('sha256');
    hashTree(hash, bundle, '', () => false);
    // Replacement with identical bytes still needs registration/indexing. Ignore ctime: macOS
    // updates bundle extended attributes after first launch without changing signed contents.
    const stat = lstatSync(bundle, { bigint: true });
    hash.update(String(stat.ino));
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function hashTree(hash, root, name, ignore) {
  if (ignore(name)) return;
  const file = path.join(root, name);
  const stat = lstatSync(file);
  hash.update(JSON.stringify([name, stat.mode]));
  if (stat.isSymbolicLink()) {
    // Framework symlinks point to entries included elsewhere in the same bundle tree.
    hash.update(JSON.stringify(readlinkSync(file)));
  } else if (stat.isDirectory()) {
    for (const child of readdirSync(file).sort())
      hashTree(hash, root, path.join(name, child), ignore);
  } else if (stat.isFile()) {
    hash.update(String(stat.size)).update('\0').update(readFileSync(file));
  } else {
    throw new Error(`Unsupported native input: ${name}`);
  }
}
