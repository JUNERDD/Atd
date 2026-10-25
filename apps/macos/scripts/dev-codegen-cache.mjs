/** Successful bridge validation, independent of the native build and installation receipt. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  codegenDependencyRoots,
  codegenFiles,
  codegenGeneratedDirectories,
  codegenSchemas,
  codegenSourceTrees,
  isCodegenScript,
} from './dev-inputs.mjs';

const run = promisify(execFile);
const VERSION = 1;

export async function createCodegenCache({ packageRoot, buildContext, signal, log, read, write }) {
  let context;
  try {
    if (process.env.NODE_OPTIONS) throw new Error('NODE_OPTIONS can load additional code.');
    const commands = [
      ['which', ['swift']],
      ['swift', ['format', '--version']],
      ['xcrun', ['--find', 'swift']],
      ['xcrun', ['--find', 'swift-format']],
    ];
    const [nativeContext, ...tools] = await Promise.all([
      buildContext,
      ...commands.map(async ([command, args]) => {
        const { stdout } = await run(command, args, {
          cwd: packageRoot,
          encoding: 'utf8',
          signal,
          timeout: 5000,
        });
        if (!stdout.trim()) throw new Error('Missing Swift tool identity.');
        return stdout.trim();
      }),
    ]);
    if (!nativeContext) throw new Error('The native toolchain is unknown.');
    const executable = realpathSync(tools[0]);
    const swift = realpathSync(tools[2]);
    if (executable !== '/usr/bin/swift' && executable !== swift)
      throw new Error('The swift command is a custom launcher.');
    context = {
      buildContext: nativeContext,
      node: [process.version, realpathSync(process.execPath)],
      tools,
      executables: [...new Set([executable, swift, realpathSync(tools[3])])],
    };
  } catch (error) {
    log(`Bridge validation reuse disabled: ${error.message}`);
  }

  const inputs = () => {
    if (!context) return null;
    try {
      const hash = createHash('sha256').update(JSON.stringify(context));
      const stamp = createHash('sha256');
      for (const executable of [process.execPath, ...context.executables]) {
        const stat = lstatSync(executable, { bigint: true });
        hash.update(`${executable}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`);
      }
      for (const name of codegenFiles) hashTree(hash, packageRoot, name, undefined, stamp);
      for (const name of codegenSourceTrees)
        hashTree(hash, packageRoot, name, (file) => file.endsWith('.ts'), stamp);
      hashTree(hash, packageRoot, 'scripts', isCodegenScript, stamp);
      for (const root of codegenDependencyRoots(packageRoot)) {
        hash.update(root);
        hashTree(hash, root, '', undefined, stamp);
      }
      return { content: hash.digest('hex'), stamp: stamp.digest('hex') };
    } catch {
      // Missing sources or dependencies require the real generator's diagnostics, never a hit.
      return null;
    }
  };
  const outputs = () => {
    try {
      const hash = createHash('sha256');
      const stamp = createHash('sha256');
      for (const name of codegenSchemas) hashTree(hash, packageRoot, name, undefined, stamp);
      for (const name of codegenGeneratedDirectories)
        hashTree(hash, packageRoot, name, (file) => file.endsWith('.swift'), stamp);
      return { content: hash.digest('hex'), stamp: stamp.digest('hex') };
    } catch {
      return null;
    }
  };

  return {
    outputFingerprint: () => outputs()?.content ?? null,
    snapshot() {
      const source = inputs();
      const generated = outputs();
      return {
        inputs: source?.content ?? null,
        outputs: generated?.content ?? null,
        stamp: `${source?.stamp ?? ''}:${generated?.stamp ?? ''}`,
      };
    },
    matches(snapshot) {
      const receipt = read()?.codegen;
      return Boolean(
        snapshot.inputs &&
        snapshot.outputs &&
        receipt?.version === VERSION &&
        receipt.inputs === snapshot.inputs &&
        receipt.outputs === snapshot.outputs,
      );
    },
    invalidate() {
      const { codegen: _previous, ...receipt } = read() ?? {};
      write(receipt);
    },
    record(snapshot) {
      if (!snapshot.inputs || !snapshot.outputs) return;
      write({
        ...read(),
        codegen: {
          version: VERSION,
          inputs: snapshot.inputs,
          outputs: snapshot.outputs,
        },
      });
    },
  };
}

function hashTree(hash, root, name, include = () => true, stamp) {
  const file = path.join(root, name);
  const stat = lstatSync(file, { bigint: true });
  if (stat.isDirectory()) {
    hash.update(JSON.stringify(['directory', name]));
    stamp?.update(`${name}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}`);
    for (const child of readdirSync(file).sort())
      hashTree(hash, root, path.join(name, child), include, stamp);
  } else if (include(name)) {
    // Follow no source symlinks: an unknown external input must disable reuse.
    if (!stat.isFile()) throw new Error(`Unsupported bridge input: ${name}`);
    hash.update(JSON.stringify(['file', name, String(stat.size)])).update(readFileSync(file));
    stamp?.update(`${name}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}`);
  }
}
