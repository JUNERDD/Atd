import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { managedSubagentConfig, SUBAGENT_CHILD_SYSTEM_PROMPT } from '../dist/subagents/config.js';
import { subagentsModuleUrl } from '../dist/subagents/package-root.js';

const distUrl = (file: string) =>
  pathToFileURL(path.join(import.meta.dirname, '..', 'dist', file)).href;

interface TriggerReport {
  wrapped: boolean;
  shutdownDisposals: (string | null)[];
  disposals: (string | null)[];
  launch: Record<string, unknown>;
  overrides: Record<string, unknown>;
}

/**
 * Installs the service's launch trigger over a scripted child factory, then loads pi-subagents'
 * extension from the entry the service loads and shuts its session down. A separate process: the
 * factory and the extension's config are process globals. Nothing here needs a model.
 */
async function triggerReport(): Promise<TriggerReport> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atd-subagent-trigger-'));
  const agentDir = path.join(root, 'agent');
  const configDir = path.join(agentDir, 'extensions/subagent');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'config.json'), JSON.stringify(managedSubagentConfig()));
  const program = `
    const childSession = await import(${JSON.stringify(subagentsModuleUrl('src', 'runs', 'shared', 'child-session.js'))});
    const disposals = [];
    const launches = [];
    const overrides = [];
    const scripted = {
      async create(launch) {
        launches.push(launch);
        return {
          settingsManager: { applyOverrides: (value) => void overrides.push(value) },
          async abort() {},
          async dispose() {},
        };
      },
      async dispose() {},
      async disposeForParent(file) { disposals.push(file ?? null); },
    };
    childSession.setChildSessionFactory(scripted);
    const { installManagedLaunchTrigger } = await import(${JSON.stringify(distUrl('subagents/trigger.js'))});
    await installManagedLaunchTrigger();
    const factory = childSession.childSessionFactory();

    const { DefaultResourceLoader, SettingsManager } = await import(
      ${JSON.stringify(import.meta.resolve('@earendil-works/pi-coding-agent'))}
    );
    const { default: subagents } = await import(${JSON.stringify(subagentsModuleUrl('index.js'))});
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR,
      settingsManager: SettingsManager.inMemory({}),
      noExtensions: true, noSkills: true, noPromptTemplates: true,
      noThemes: true, noContextFiles: true, extensionFactories: [subagents],
    });
    await loader.reload();
    const { extensions, errors } = loader.getExtensions();
    if (errors.length) throw new Error(JSON.stringify(errors));
    for (const handler of extensions[0].handlers.get('session_shutdown') ?? []) {
      await handler({ type: 'session_shutdown', reason: 'exit' });
    }
    const shutdownDisposals = [...disposals];
    await childSession.disposeChildSessionsForParent('/parent/session.jsonl');

    await factory.create({ cwd: process.cwd(), noContextFiles: false, storage: { kind: 'memory' } });
    console.log(JSON.stringify({
      wrapped: factory !== scripted,
      shutdownDisposals,
      disposals,
      launch: launches[0],
      overrides: overrides[0],
    }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: root,
      env: {
        PATH: process.env['PATH'],
        TMPDIR: root,
        PI_CODING_AGENT_DIR: agentDir,
        PI_SUBAGENTS_TEMP_ROOT: path.join(root, 'subagents'),
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const lines = result.stdout.trim().split('\n');
    return JSON.parse(lines.at(-1) ?? '') as TriggerReport;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

let reported: Promise<TriggerReport> | undefined;
const report = () => (reported ??= triggerReport());

test('the launch trigger wraps the child factory the loaded extension ends children through', async () => {
  const { wrapped, shutdownDisposals, disposals } = await report();
  assert.equal(wrapped, true, 'pi-subagents must create children through the trigger');
  // The extension's own shutdown reaches the wrapper (no parent session was started here), so
  // the trigger and the extension share one child-session module.
  assert.deepEqual(shutdownDisposals, [null]);
  assert.deepEqual(disposals, [null, '/parent/session.jsonl']);
});

test('the launch trigger pins the service limits and turns cache warming off for children', async () => {
  const { launch, overrides } = await report();
  assert.equal(launch['projectTrusted'], false);
  assert.equal(launch['noContextFiles'], true);
  assert.equal(launch['systemPrompt'], SUBAGENT_CHILD_SYSTEM_PROMPT);
  assert.equal(launch['appendSystemPrompt'], '');
  // Pi 1.5.1 made idle warming the default; children must not warm caches between runs.
  assert.equal(overrides['cacheWarming'], 'off');
  assert.ok(overrides['retry'] && overrides['httpIdleTimeoutMs'], 'request policy applied');
});
