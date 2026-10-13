import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Proves the pack can still do the app work the service asks of it: the bundled Node
 * imports the pack's own `@atd/app-kit`, whose toolchain must resolve entirely inside the pack,
 * typechecks and builds the app template in the same sandboxes the service uses, passes the
 * backend sandbox self-check, and runs the pack's npm in the installer sandbox with its fixed
 * configuration (`npmSelfCheck`, which needs no network).
 */
export function checkAppToolchain(nodePath, packRoot) {
  const entry = path.join(packRoot, 'node_modules', '@atd', 'app-kit', 'dist', 'node', 'index.js');
  const script = `
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    const kit = await import(${JSON.stringify(pathToFileURL(entry).href)});
    const pack = ${JSON.stringify(packRoot)};
    const toolchain = kit.loadToolchain();
    const paths = [toolchain.root, toolchain.tsc, toolchain.npm.cli, ...toolchain.readRoots,
      ...toolchain.cssAliases.map((alias) => alias.file), ...Object.values(toolchain.typePackages)];
    const outside = paths.filter((file) => file !== pack && !file.startsWith(pack + path.sep));
    if (outside.length > 0) throw new Error('Toolchain paths outside the pack: ' + outside);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'atd-pack-check-'));
    try {
      const staged = await kit.prepareStaging(path.join(toolchain.root, 'template'), path.join(work, 'staging'));
      if (!staged.ok) throw new Error('Staging failed: ' + JSON.stringify(staged.errors));
      const [typecheck, build] = await Promise.all([
        kit.typecheckApp({ app: staged.app, workDir: path.join(work, 'typecheck') }),
        kit.buildApp({ app: staged.app, outDir: path.join(work, 'out'), workDir: path.join(work, 'build') }),
      ]);
      if (!typecheck.ok) throw new Error('Typecheck failed: ' + JSON.stringify(typecheck).slice(0, 4000));
      if (!build.ok) throw new Error('Build failed: ' + JSON.stringify(build).slice(0, 4000));
      const sandbox = await kit.selfCheckSandbox({ workDir: path.join(work, 'self-check') });
      if (!sandbox.ok) throw new Error('Sandbox self-check failed: ' + sandbox.reason);
      const npm = await kit.npmSelfCheck({ workDir: path.join(work, 'npm-check') });
      if (!npm.ok) throw new Error('npm self-check failed: ' + npm.reason);
      console.log('App toolchain check: typecheck ' + typecheck.durationMs + ' ms, build ' + build.durationMs + ' ms, sandbox ok, npm ' + npm.version + ' ok');
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  `;
  const run = spawnSync(nodePath, ['--input-type=module', '--eval', script], {
    cwd: packRoot,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
    stdio: 'inherit',
    timeout: 300_000,
  });
  if (run.status !== 0) throw new Error('The pack failed the app toolchain check.');
}
