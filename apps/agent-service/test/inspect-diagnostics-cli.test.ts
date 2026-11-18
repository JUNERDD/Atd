import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'scripts',
  'inspect-diagnostics.mjs',
);

interface InspectorModule {
  isSafeArchivePath: (entryName: string) => boolean;
  parseZipEntries: (buf: Buffer) => Map<string, Buffer>;
  inspectDiagnosticsArchive: (archivePath: string) => {
    doctor: { totalChecks: number; issues: Array<{ status: string }> };
    timeline: Array<{ source: string }>;
  };
}

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

test(
  'scripts/inspect-diagnostics.mjs parses real /usr/bin/ditto BIT-3 streaming ZIP archives',
  { skip: process.platform !== 'darwin' },
  async () => {
    const mod = (await import(pathToFileURL(scriptPath).href)) as InspectorModule;
    assert.equal(mod.isSafeArchivePath('manifest.json'), true);
    assert.equal(mod.isSafeArchivePath('../etc/passwd'), false);
    assert.equal(mod.isSafeArchivePath('/abs/path'), false);

    const root = await makeTempDir('atd-ditto-zip-');
    const bundleDir = path.join(root, 'atd-diagnostics-20261118T000000Z');
    const zipPath = path.join(root, 'bundle.zip');
    await mkdir(path.join(bundleDir, 'decision-rings'), { recursive: true });
    await mkdir(path.join(bundleDir, 'logs'), { recursive: true });

    await writeFile(
      path.join(bundleDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-11-18T00:00:00.000Z',
        triggerSurface: 'settings',
        isDevelopment: false,
        totals: {
          uncompressedBytes: 1200,
          includedFiles: 4,
          omittedFiles: 1,
          redactionReplacements: 3,
        },
        files: [
          {
            path: 'crashes/summary.json',
            status: 'omitted_not_opted_in',
            byteSize: 0,
            sha256: null,
          },
        ],
      }),
    );
    await writeFile(
      path.join(bundleDir, 'doctor-report.json'),
      JSON.stringify({
        checks: [
          {
            id: 'shell.login_path',
            layer: 'shell_and_toolchain',
            status: 'warn',
            reasonCode: 'login_shell_slow_gt_2500ms',
            durationMs: 2800,
            metrics: {},
          },
          {
            id: 'service.lock',
            layer: 'service_and_storage',
            status: 'fail',
            reasonCode: 'corrupt_lock_auto_recovered',
            durationMs: 4,
            metrics: {},
          },
          {
            id: 'shell.node_runtime',
            layer: 'shell_and_toolchain',
            status: 'pass',
            reasonCode: 'ok',
            durationMs: 1,
            metrics: {},
          },
        ],
      }),
    );
    await writeFile(
      path.join(bundleDir, 'decision-rings', 'run-prep.json'),
      JSON.stringify({
        entries: [
          {
            seq: 1,
            ts: '2026-11-18T00:00:01.000Z',
            phase: 'freeze_memory',
            outcome: 'degraded',
            reasonCode: 'memory_degraded',
          },
        ],
      }),
    );
    await writeFile(
      path.join(bundleDir, 'logs', 'service.tail.jsonl'),
      `${JSON.stringify({ ts: '2026-11-18T00:00:02.000Z', level: 'error', msg: 'disk low' })}\n`,
    );

    execFileSync('/usr/bin/ditto', [
      '-c',
      '-k',
      '--norsrc',
      '--noextattr',
      '--keepParent',
      bundleDir,
      zipPath,
    ]);

    const zipBytes = await readFile(zipPath);
    const manifestHeaderOffset =
      zipBytes.indexOf('atd-diagnostics-20261118T000000Z/manifest.json') - 30;
    assert.ok(manifestHeaderOffset > 0);
    assert.equal(zipBytes.readUInt32LE(manifestHeaderOffset), 0x04034b50);
    const lfhFlags = zipBytes.readUInt16LE(manifestHeaderOffset + 6);
    const lfhCompressedSize = zipBytes.readUInt32LE(manifestHeaderOffset + 18);
    assert.ok((lfhFlags & 0x08) !== 0, 'ditto should set BIT-3 streaming flag on file entries');
    assert.equal(lfhCompressedSize, 0, 'ditto local header compressedSize should be 0');

    const entries = mod.parseZipEntries(zipBytes);
    assert.ok(entries.has('manifest.json'));
    assert.ok(entries.has('doctor-report.json'));

    const summary = mod.inspectDiagnosticsArchive(zipPath);
    assert.equal(summary.doctor.totalChecks, 3);
    assert.equal(summary.doctor.issues.length, 2);
    assert.equal(summary.doctor.issues[0]!.status, 'fail');
    assert.equal(summary.timeline.length, 2);

    const jsonOut = execFileSync(process.execPath, [scriptPath, '--json', zipPath], {
      encoding: 'utf8',
    });
    const parsedOut = JSON.parse(jsonOut) as { doctor: { issues: unknown[] } };
    assert.equal(parsedOut.doctor.issues.length, 2);

    const humanOut = execFileSync(process.execPath, [scriptPath, zipPath], { encoding: 'utf8' });
    assert.match(humanOut, /corrupt_lock_auto_recovered/);
    assert.match(humanOut, /OMITTED/);
  },
);
