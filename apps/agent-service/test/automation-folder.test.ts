import assert from 'node:assert/strict';
import { appendFile, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { AutomationDraft, AutomationFolderEvent } from '@atd/agent-contracts';
import { setAutomationEnabled } from '../dist/automations/edits.js';
import { scanFolder } from '../dist/automations/folder-scan.js';
import type { FolderScanner } from '../dist/automations/folder-watch.js';
import { automationKit } from './automation-kit.ts';

/**
 * Folder triggers (decision D8) against a real temporary folder: the baseline is the folder as it
 * was when the trigger was saved or turned on, a new matching file fires once it is unchanged
 * across two scans, hidden files and partial downloads never count, changes during the
 * automation's run wait for it to end, and changes made while the service was stopped are skipped
 * when the automation skips missed runs.
 */

let kit: Awaited<ReturnType<typeof automationKit>> | null = null;
let watched = '';
beforeEach(async () => {
  watched = await realpath(await mkdtemp(path.join(tmpdir(), 'automation-watched-')));
});
afterEach(async () => {
  await kit?.stop();
  kit = null;
  await rm(watched, { recursive: true, force: true });
});

async function open(
  policy: Partial<AutomationDraft['policy']> = {},
  events: AutomationFolderEvent[] = ['added'],
) {
  const k = await automationKit('2026-10-06T08:00:00Z');
  kit = k;
  const { registered } = await k.folders.register([watched]);
  const folderId = registered[0]?.folder.id;
  assert.ok(folderId);
  const base = (await k.create({ enabled: false })).policy;
  const automation = await k.create({
    name: 'Invoices',
    trigger: { kind: 'folder', folderId, events, patterns: ['*.PDF'], recursive: true },
    policy: { ...base, ...policy },
  });
  let minute = 0;
  /** One engine tick, a minute after the last. */
  const tick = () => {
    minute += 1;
    return k.tick(new Date(Date.parse('2026-10-06T08:00:00Z') + minute * 60_000).toISOString());
  };
  return { k, automation, folderId, tick };
}

test('a file added right after the save fires; one there before never does', async () => {
  await writeFile(path.join(watched, 'before.pdf'), 'there when the trigger was saved');
  const { k, automation, tick } = await open();
  await writeFile(path.join(watched, 'after.pdf'), 'added right after the save');
  await tick();
  await tick();
  assert.equal(k.submitted.length, 1, 'the first scan after the save already tracks changes');
  assert.deepEqual(k.runs(automation.id)[0]?.files, ['after.pdf']);
  const fire = k.submitted[0];
  assert.ok(fire);
  await k.finish(fire.taskId, fire.runId, 'completed', 'Filed it.');
  await k.settle();

  // Turning it on again takes the folder as it is then: what arrived while it was off never fires.
  await setAutomationEnabled(k.service.edits(), automation.id, { enabled: false });
  await writeFile(path.join(watched, 'while-off.pdf'), 'arrived while it was off');
  await setAutomationEnabled(k.service.edits(), automation.id, { enabled: true });
  await writeFile(path.join(watched, 'after-on.pdf'), 'added right after turning it on');
  await tick();
  await tick();
  assert.equal(k.submitted.length, 2);
  assert.deepEqual(k.runs(automation.id)[0]?.files, ['after-on.pdf']);
});

test('a new matching file fires once it settles; noise never fires', async () => {
  await writeFile(path.join(watched, 'old.pdf'), 'already there');
  const { k, automation, folderId, tick } = await open();
  await tick();
  await writeFile(path.join(watched, 'Invoice-1.pdf'), 'new');
  await writeFile(path.join(watched, 'notes.txt'), 'other kind');
  await writeFile(path.join(watched, '.hidden.pdf'), 'hidden');
  await writeFile(path.join(watched, 'big.pdf.crdownload'), 'downloading');
  await writeFile(path.join(watched, '~$lock.pdf'), 'office lock');
  await mkdir(path.join(watched, 'sub', 'deeper'), { recursive: true });
  await writeFile(path.join(watched, 'sub', 'deeper', 'nested.pdf'), 'nested');
  await tick();
  assert.equal(k.submitted.length, 0, 'not settled yet');
  await tick();
  assert.equal(k.submitted.length, 1);
  const fire = k.submitted[0];
  assert.ok(fire);
  assert.deepEqual(fire.request.input.folders, [folderId], 'the run may read the folder');
  const text = fire.request.input.text;
  assert.match(text, /Files were added or changed in the watched folder/);
  assert.match(text, /- Invoice-1\.pdf\n- sub\/deeper\/nested\.pdf\n/);
  assert.doesNotMatch(text, /old\.pdf|notes\.txt|hidden|crdownload|lock\.pdf/);
  const [record] = k.runs(automation.id);
  assert.equal(record?.source, 'folder');
  assert.deepEqual(record?.files, ['Invoice-1.pdf', 'sub/deeper/nested.pdf']);

  // A change during the run waits for it to end; a changed file is not an `added` one.
  await writeFile(path.join(watched, 'Invoice-2.pdf'), 'second');
  await writeFile(path.join(watched, 'Invoice-1.pdf'), 'edited');
  await tick();
  await tick();
  assert.equal(k.submitted.length, 1, 'single-flight keeps the new file waiting');
  await k.finish(fire.taskId, fire.runId, 'completed', 'Filed two invoices.');
  await k.settle();
  await tick();
  assert.equal(k.submitted.length, 2);
  assert.deepEqual(k.runs(automation.id)[0]?.files, ['Invoice-2.pdf']);
  await tick();
  assert.equal(k.submitted.length, 2, 'fired files never fire again');
});

test("a run's own writes never fire it; a person's change made meanwhile still does", async () => {
  const { k, automation, tick } = await open();
  await tick();
  await writeFile(path.join(watched, 'in.pdf'), 'input');
  await tick();
  await tick();
  const fire = k.submitted[0];
  assert.ok(fire);
  // While the run goes on, it writes its output into the folder and a person drops a file there.
  await writeFile(path.join(watched, 'out.pdf'), 'summary');
  await writeFile(path.join(watched, 'other.pdf'), 'from a person');
  await tick();
  await tick();
  await mkdir(k.paths.auditDir, { recursive: true });
  const written = (await realpath(path.join(watched, 'out.pdf'))).normalize('NFC');
  const line = { decision: 'wrote', tool: 'write', path: written };
  await appendFile(path.join(k.paths.auditDir, `${fire.runId}.jsonl`), `${JSON.stringify(line)}\n`);
  // Its last write lands after the last scan of the run.
  await writeFile(path.join(watched, 'out.pdf'), 'final summary');
  await k.finish(fire.taskId, fire.runId, 'completed', 'Filed it.');
  await k.settle();
  await tick();
  await tick();
  assert.equal(k.submitted.length, 2);
  assert.deepEqual(k.runs(automation.id)[0]?.files, ['other.pdf'], "only the person's file fires");
  await tick();
  await tick();
  assert.equal(k.submitted.length, 2, "the run's output never fires");
});

test('changes made while the service was stopped are skipped when missed runs are', async () => {
  const { k, automation, tick } = await open({ missedRuns: 'skip' });
  await tick();
  await k.restart();
  await writeFile(path.join(watched, 'offline.pdf'), 'arrived while closed');
  await tick();
  await tick();
  await tick();
  assert.equal(k.submitted.length, 0);
  const [skipped] = k.runs(automation.id);
  assert.equal(skipped?.outcome, 'skipped');
  assert.equal(skipped?.reason, 'missed');
  assert.deepEqual(skipped?.files, ['offline.pdf']);
  await writeFile(path.join(watched, 'later.pdf'), 'arrived while running');
  await tick();
  await tick();
  assert.equal(k.submitted.length, 1, 'later changes fire as usual');
});

test('changes made while the service was stopped fire when missed runs run once', async () => {
  const { k, tick } = await open();
  await tick();
  await k.restart();
  await writeFile(path.join(watched, 'offline.pdf'), 'arrived while closed');
  await tick();
  await tick();
  assert.equal(k.submitted.length, 1);
});

test('a scan never enters the data directory and refuses a folder with too many files', async () => {
  const dataDir = path.join(watched, 'AgentService');
  await mkdir(path.join(dataDir, 'tasks'), { recursive: true });
  await writeFile(path.join(dataDir, 'tasks', 'output.pdf'), 'written by a run');
  await writeFile(path.join(watched, 'mine.pdf'), 'mine');
  const scan = await scanFolder(watched, { recursive: true, patterns: [], dataDir });
  assert.ok(scan.ok);
  assert.deepEqual([...scan.files.keys()], ['mine.pdf']);
  const crowded = path.join(watched, 'crowded');
  await mkdir(crowded);
  await Promise.all(
    Array.from({ length: 10_001 }, (_, index) => writeFile(path.join(crowded, `${index}.txt`), '')),
  );
  const full = await scanFolder(crowded, { recursive: false, patterns: [], dataDir });
  assert.deepEqual(full, { ok: false, reason: 'tooMany' });
  const missing = await scanFolder(path.join(watched, 'gone'), {
    recursive: false,
    patterns: [],
    dataDir,
  });
  assert.deepEqual(missing, { ok: false, reason: 'unavailable' });
});

test('a metadata-only change never fires a changed trigger; a content change does', async () => {
  await writeFile(path.join(watched, 'report.pdf'), 'version one');
  const { k, automation, tick } = await open({}, ['changed']);
  await tick();
  // Permissions, tags and quarantine flags move only the change time.
  await chmod(path.join(watched, 'report.pdf'), 0o600);
  await tick();
  await tick();
  assert.equal(k.submitted.length, 0, 'metadata is not content');
  await writeFile(path.join(watched, 'report.pdf'), 'version two, edited');
  await tick();
  await tick();
  assert.equal(k.submitted.length, 1);
  assert.deepEqual(k.runs(automation.id)[0]?.files, ['report.pdf']);
});

test('a folder that never answers holds neither the tick nor the shutdown', async () => {
  let reads = 0;
  const hung: FolderScanner = {
    timeoutMs: 50,
    scan: () => {
      reads += 1;
      return new Promise(() => undefined);
    },
  };
  const k = await automationKit('2026-10-06T08:00:00Z', { scanner: hung });
  kit = k;
  const { registered } = await k.folders.register([watched]);
  const folderId = registered[0]?.folder.id;
  assert.ok(folderId);
  const schedule = await k.create({ name: 'Morning digest' });
  const trigger = { kind: 'folder' as const, folderId, events: ['added' as const], patterns: [] };
  const folder = await k.create({ name: 'Inbox', trigger: { ...trigger, recursive: false } });
  assert.equal(reads, 1, 'saving it tried to read the folder');
  assert.equal((await k.service.item(folder.id)).status.problem, 'folderUnavailable');
  const ticking = Date.now();
  await k.tick('2026-10-06T09:00:10Z');
  await k.tick('2026-10-06T09:00:40Z');
  assert.ok(Date.now() - ticking < 2000, 'the ticks did not wait for the folder');
  assert.equal(reads, 1, 'a read that never came back is not started again');
  assert.equal(k.runs(schedule.id)[0]?.outcome, 'running', 'schedules still fire');
  const stopping = Date.now();
  await k.service.stop();
  assert.ok(Date.now() - stopping < 2000, 'the stop did not wait for the folder');
});
