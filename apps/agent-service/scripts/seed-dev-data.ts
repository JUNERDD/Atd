/**
 * Offline entry for the same configuration-only import exposed in development Settings.
 * Source: installed app by default. Target: AI_AGENT_DATA_DIR, then AgentService Dev.
 * Models, provider connections, credentials and conversation data never participate.
 *
 * pnpm --filter @atd/agent-service seed:dev [--dry-run] [--from <dataDir>] [--to <dataDir>]
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { acquireLock, releaseLock } from '../src/config.js';
import { commitDevelopmentSync } from '../src/development/commit.js';
import { planDevelopmentSync } from '../src/development/plan.js';
import { SettingsStore } from '../src/settings/store.js';
import { defaultDataDir, resolveAtdHome, servicePaths } from '../src/storage.js';

function options(argv: string[]) {
  let dryRun = false;
  let from = defaultDataDir();
  let to =
    process.env.AI_AGENT_DATA_DIR?.trim() ||
    path.join(homedir(), 'Library', 'Application Support', 'AgentService Dev');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--from' || arg === '--to') {
      const value = argv[(index += 1)];
      if (!value) throw new Error(`${arg} needs a directory.`);
      if (arg === '--from') from = value;
      else to = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { dryRun, from: path.resolve(from), to: path.resolve(to) };
}

async function seed() {
  const { dryRun, from, to } = options(process.argv.slice(2));
  const source = { dataDir: from, home: resolveAtdHome({ dataDir: from }) };
  const target = {
    dataDir: to,
    home: resolveAtdHome({ envHome: process.env.AI_ATD_HOME, dataDir: to }),
  };
  const settings = await SettingsStore.load(to, 'auto');
  if (dryRun) {
    const plan = await planDevelopmentSync(source, target, settings);
    console.log(`From ${from}\nTo   ${to}`);
    for (const copy of plan.copies) console.log(`  ${copy.label}`);
    return;
  }
  const paths = servicePaths(to);
  // Check the source/target boundary before creating even the owner's lock.
  await planDevelopmentSync(source, target, settings);
  await acquireLock(paths);
  try {
    const liveSettings = await SettingsStore.load(to, 'auto');
    const plan = await planDevelopmentSync(source, target, liveSettings);
    const result = await commitDevelopmentSync(plan, liveSettings);
    console.log(
      `Synced ${result.commands} commands, ${result.skills} skills and ${result.agents} agents.`,
    );
    if (result.backupDir) console.log(`Replaced files are in ${result.backupDir}`);
    console.log('Seeded. Start pnpm dev to use the imported configuration.');
  } finally {
    await releaseLock(paths);
  }
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
