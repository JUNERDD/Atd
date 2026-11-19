import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

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
    entryCount: number;
    doctor: { totalChecks: number; issues: Array<{ status: string }> };
    timeline: Array<{ ts: string; source: string; summary: string }>;
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

function buildDeflatedZip(
  entries: Array<{ name: string; rawLen: number; deflated: Buffer }>,
): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let localOffset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(e.deflated.length, 18);
    lfh.writeUInt32LE(e.rawLen, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    localParts.push(lfh, nameBuf, e.deflated);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(e.deflated.length, 20);
    cdh.writeUInt32LE(e.rawLen, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(localOffset, 42);
    cdParts.push(cdh, nameBuf);
    localOffset += 30 + nameBuf.length + e.deflated.length;
  }
  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, cdBuf, eocd]);
}

test('B10: inspect-diagnostics enforces pre-stat 64 MiB archive cap, CD bounds, and 32 MiB cumulative inflation cap', async () => {
  const mod = (await import(pathToFileURL(scriptPath).href)) as InspectorModule;
  const sixteenMibZeros = Buffer.alloc(16 * 1024 * 1024);
  const deflatedChunk = deflateRawSync(sixteenMibZeros);
  const bombZip = buildDeflatedZip(
    Array.from({ length: 4 }, (_, i) => ({
      name: `logs/bomb-${i}.bin`,
      rawLen: sixteenMibZeros.length,
      deflated: deflatedChunk,
    })),
  );
  assert.ok(bombZip.length < 1024 * 1024);
  assert.throws(() => mod.parseZipEntries(bombZip), /32 MiB cumulative uncompressed limit/);

  // Forged BIT-3 style CD with rawLen = 0 must also halt on actual inflated bytes.
  const zeroHeaderBomb = buildDeflatedZip(
    Array.from({ length: 4 }, (_, i) => ({
      name: i === 0 ? 'manifest.json' : `logs/service.tail.jsonl`,
      rawLen: 0,
      deflated: deflatedChunk,
    })),
  );
  assert.throws(
    () => mod.parseZipEntries(zeroHeaderBomb),
    /32 MiB|Cannot create a Buffer|maxOutputLength/i,
  );

  // Truncated CD entry name overflowing cdOffset + cdSize must be rejected.
  const corruptCd = Buffer.from(
    buildDeflatedZip([
      { name: 'manifest.json', rawLen: 2, deflated: deflateRawSync(Buffer.from('{}')) },
    ]),
  );
  const cdPos = corruptCd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corruptCd.writeUInt16LE(500, cdPos + 28);
  assert.throws(() => mod.parseZipEntries(corruptCd), /Central Directory entry bounds/);

  // Sparse >64 MiB file must fail at statSync before readFileSync allocates memory.
  const root = await makeTempDir('atd-oversize-zip-');
  const hugePath = path.join(root, 'huge.zip');
  const fh = await open(hugePath, 'w');
  await fh.truncate(65 * 1024 * 1024);
  await fh.close();
  assert.throws(() => mod.inspectDiagnosticsArchive(hugePath), /64 MiB/);
});

test(
  'B6: inspect-diagnostics surfaces native ring anomalies and fault logs while ignoring normal selection clicks',
  { skip: process.platform !== 'darwin' },
  async () => {
    const mod = (await import(pathToFileURL(scriptPath).href)) as InspectorModule;
    const root = await makeTempDir('atd-rings-zip-');
    const bundleDir = path.join(root, 'bundle');
    const zipPath = path.join(root, 'rings.zip');
    await mkdir(path.join(bundleDir, 'decision-rings'), { recursive: true });
    await mkdir(path.join(bundleDir, 'logs'), { recursive: true });
    const writeRing = (name: string, entries: unknown[]) =>
      writeFile(path.join(bundleDir, 'decision-rings', name), JSON.stringify({ entries }));
    await writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1 }));
    await writeRing('selection.json', [
      { seq: 1, ts: '2026-11-18T00:00:01Z', flags: 0, dropStage: 2 },
      { seq: 2, ts: '2026-11-18T00:00:02Z', flags: 1024, attempt0AxError: -25204, dropStage: 0 },
    ]);
    await writeRing('hotkeys.json', [
      { seq: 1, ts: '2026-11-18T00:00:03Z', subject: 'toggle_panel', outcome: 1 },
      {
        seq: 2,
        ts: '2026-11-18T00:00:04Z',
        subject: 'toggle_panel',
        outcome: 2,
        tapDisabledCount: 1,
      },
    ]);
    await writeRing('capture-arbiter.json', [
      { seq: 1, ts: '2026-11-18T00:00:05Z', ownerSummary: 'save_panel', outcome: 2, errorCode: 0 },
    ]);
    await writeRing('relay-supervisor.json', [
      {
        seq: 1,
        ts: '2026-11-18T00:00:06Z',
        detail: 'service_crashed',
        outcome: 2,
        crashCount: 3,
        httpOrWsCode: 503,
      },
    ]);
    await writeFile(
      path.join(bundleDir, 'logs', 'shell.tail.jsonl'),
      `${JSON.stringify({ ts: '2026-11-18T00:00:07Z', level: 'fault', msg: 'WebContent crash loop' })}\n`,
    );
    const dittoFlags = ['-c', '-k', '--norsrc', '--noextattr', '--keepParent'];
    execFileSync('/usr/bin/ditto', [...dittoFlags, bundleDir, zipPath]);

    const summary = mod.inspectDiagnosticsArchive(zipPath);
    assert.equal(summary.timeline.length, 5);
    assert.ok(!summary.timeline.some((e) => e.summary === '2'));
    assert.match(summary.timeline[0]!.summary, /secure_input.*ax_error=-25204/);
    assert.match(summary.timeline[1]!.summary, /toggle_panel.*outcome=2.*tapDisabledCount=1/);
    assert.match(summary.timeline[2]!.summary, /save_panel.*outcome=2/);
    assert.match(
      summary.timeline[3]!.summary,
      /service_crashed.*outcome=2.*httpOrWsCode=503.*crashCount=3/,
    );
    assert.equal(summary.timeline[4]!.source, 'shell.tail.jsonl:fault');
  },
);
