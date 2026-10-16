import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DISABLED_SUBAGENT_FEATURES, managedSubagentConfig } from '../dist/subagents/config.js';

// Load the real patched extension in separate processes: its config and temporary paths are
// process globals. Registration needs neither a model nor a running agent service.
async function registrations(disabled: boolean) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atd-watchdog-'));
  const agentDir = path.join(root, 'agent');
  const configDir = path.join(agentDir, 'extensions/subagent');
  await mkdir(configDir, { recursive: true });
  const config = managedSubagentConfig();
  if (!disabled)
    config['disabledFeatures'] = DISABLED_SUBAGENT_FEATURES.filter(
      (feature) => feature !== 'watchdog',
    );
  await writeFile(path.join(configDir, 'config.json'), JSON.stringify(config));
  const program = `
    const { DefaultResourceLoader, SettingsManager } = await import(
      ${JSON.stringify(import.meta.resolve('@earendil-works/pi-coding-agent'))}
    );
    const { default: subagents } = await import(${JSON.stringify(import.meta.resolve('pi-subagents'))});
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR,
      settingsManager: SettingsManager.inMemory({}),
      noExtensions: true, noSkills: true, noPromptTemplates: true,
      noThemes: true, noContextFiles: true, extensionFactories: [subagents],
    });
    await loader.reload();
    const { extensions, errors } = loader.getExtensions();
    if (errors.length) throw new Error(JSON.stringify(errors));
    if (extensions.length !== 1) throw new Error('Expected only the subagent extension');
    const extension = extensions[0];
    const result = {
      watchdogCommand: extension.commands.has('subagents-watchdog'),
      startHandlers: extension.handlers.get('session_start')?.length ?? 0,
      inputHandlers: extension.handlers.get('input')?.length ?? 0,
      subagentTool: extension.tools.has('subagent'),
    };
    for (const handler of extension.handlers.get('session_shutdown') ?? []) {
      await handler({ type: 'session_shutdown', reason: 'exit' });
    }
    console.log(JSON.stringify(result));
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
    return JSON.parse(result.stdout) as {
      watchdogCommand: boolean;
      startHandlers: number;
      inputHandlers: number;
      subagentTool: boolean;
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('disabling watchdog removes its command and lifecycle hooks without removing subagents', async () => {
  const disabled = await registrations(true);
  const enabled = await registrations(false);
  assert.equal(disabled.watchdogCommand, false);
  assert.equal(enabled.watchdogCommand, true);
  assert.equal(disabled.subagentTool, true);
  assert.equal(enabled.subagentTool, true);
  assert.equal(disabled.startHandlers, enabled.startHandlers - 1);
  assert.equal(disabled.inputHandlers, enabled.inputHandlers - 1);
});
