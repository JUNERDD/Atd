/**
 * One-way seed of a development data dir from the installed app's: settings, commands, provider
 * connections with their keyring credentials, and the Personal skills and agents of the product
 * home. The source is only read. The target is never the installed app's data dir, and the script
 * holds the target's owner lock while it writes, so it refuses while a service serves it.
 *
 * Every target file or folder it replaces moves to `<target>/seed-backups/<UTC stamp>/` first.
 * Provider connections merge by id with the source winning; connections only the target has stay.
 * Credentials go from the source's keyring namespace to the target's and never touch the disk.
 *
 *   pnpm --filter @atd/agent-service seed:dev [--dry-run] [--from <dataDir>] [--to <dataDir>]
 *
 * `--from` defaults to the installed app's data dir; `--to` to AI_AGENT_DATA_DIR, then the dev
 * data dir `pnpm dev` serves.
 */
import { cp, mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  parse,
  ServiceConnectionsFileSchema,
  type ServiceConnectionsFile,
} from '@atd/agent-contracts';
import { BUILTIN_SKILLS } from '../src/builtins/manifest.js';
import { acquireLock, atomicWrite, releaseLock } from '../src/config.js';
import { connectionsFile } from '../src/credentials/connections.js';
import { keyringAccount, KeyringBackend } from '../src/credentials/keyring.js';
import {
  defaultDataDir,
  readServiceId,
  resolveAtdHome,
  servicePaths,
  type ServicePaths,
} from '../src/storage.js';

/** The data dir the `dev` script of this package serves. */
const DEV_DATA_DIR = path.join(homedir(), 'Library', 'Application Support', 'AgentService Dev');
/** Whole files that the source replaces, relative to the data dir. */
const COPIED_FILES = ['settings.json', 'commands.json'];

interface Options {
  dryRun: boolean;
  from: string;
  to: string;
}

/** One file or folder the seed puts in place, with where it comes from. */
interface Copy {
  label: string;
  source: string;
  target: string;
}

function parseOptions(argv: string[]): Options {
  let dryRun = false;
  let from: string | undefined;
  let to: string | undefined;
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
  return {
    dryRun,
    from: path.resolve(from ?? defaultDataDir()),
    to: path.resolve(to ?? (process.env.AI_AGENT_DATA_DIR?.trim() || DEV_DATA_DIR)),
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function serviceIdOf(paths: ServicePaths, role: string, hint: string): Promise<string> {
  try {
    return await readServiceId(paths);
  } catch {
    throw new Error(`The ${role} data dir ${paths.root} has no service identity. ${hint}`);
  }
}

async function readConnections(dataDir: string): Promise<ServiceConnectionsFile> {
  const file = connectionsFile(dataDir);
  if (!(await exists(file))) return { version: 1, defaultConnectionId: null, connections: [] };
  return parse(ServiceConnectionsFileSchema, JSON.parse(await readFile(file, 'utf8')));
}

/** Whole-file copies and the product home's Personal skills and agents; built-in skills excluded. */
async function plannedCopies(options: Options): Promise<Copy[]> {
  const copies: Copy[] = [];
  for (const name of COPIED_FILES) {
    const source = path.join(options.from, name);
    if (await exists(source))
      copies.push({ label: name, source, target: path.join(options.to, name) });
  }
  // The installed app's service never sees this shell's AI_ATD_HOME; the target's service does.
  const sourceHome = resolveAtdHome({ dataDir: options.from });
  const targetHome = resolveAtdHome({ envHome: process.env.AI_ATD_HOME, dataDir: options.to });
  if (sourceHome === targetHome) return copies;
  const builtins = new Set(BUILTIN_SKILLS.map((entry) => entry.name));
  for (const folder of ['skills', 'agents']) {
    const root = path.join(sourceHome, folder);
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (folder === 'skills' && (!entry.isDirectory() || builtins.has(entry.name))) continue;
      if (folder === 'agents' && (!entry.isFile() || !entry.name.endsWith('.md'))) continue;
      copies.push({
        label: `${folder}/${entry.name}`,
        source: path.join(root, entry.name),
        target: path.join(targetHome, folder, entry.name),
      });
    }
  }
  return copies;
}

/** The target's connections with the source's laid over them by id. */
function mergeConnections(
  source: ServiceConnectionsFile,
  target: ServiceConnectionsFile,
): ServiceConnectionsFile {
  const incoming = new Set(source.connections.map((item) => item.connectionId));
  return {
    ...target,
    defaultConnectionId: source.defaultConnectionId ?? target.defaultConnectionId,
    connections: [
      ...target.connections.filter((item) => !incoming.has(item.connectionId)),
      ...source.connections,
    ],
  };
}

/** Moves what sits at `target` into the backup dir, keeping its path relative to `root`. */
async function backUp(target: string, root: string, backupDir: string): Promise<boolean> {
  if (!(await exists(target))) return false;
  const relative = path.relative(root, target);
  const destination = path.join(
    backupDir,
    relative.startsWith('..') ? path.basename(target) : relative,
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(target, destination);
  return true;
}

async function seed(options: Options): Promise<void> {
  if (options.from === options.to) throw new Error('--from and --to name the same data dir.');
  if (options.to === path.resolve(defaultDataDir()))
    throw new Error('The target is the installed app’s data dir; the seed never writes there.');
  const from = servicePaths(options.from);
  const to = servicePaths(options.to);
  const sourceId = await serviceIdOf(from, 'source', 'Open the installed app once first.');
  const targetId = await serviceIdOf(to, 'target', 'Run `pnpm dev` once first.');

  const copies = await plannedCopies(options);
  const source = await readConnections(options.from);
  const merged = mergeConnections(source, await readConnections(options.to));
  const credentialed = source.connections.filter((item) => item.hasCredential);

  console.log(`From ${options.from}\nTo   ${options.to}`);
  for (const copy of copies) console.log(`  copy        ${copy.label}`);
  for (const item of source.connections)
    console.log(
      `  connection  ${item.name} (${item.provider})${item.hasCredential ? ' + credential' : ''}`,
    );
  if (copies.length === 0 && source.connections.length === 0) console.log('  nothing to seed');
  if (options.dryRun) return;

  try {
    await acquireLock(to);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Stop \`pnpm dev\` and run again.`,
      { cause: error },
    );
  }
  try {
    // Every secret is read before anything is written, so a refused keychain prompt changes nothing.
    const sourceKeyring = new KeyringBackend(sourceId);
    const secrets = new Map<string, string>();
    for (const item of credentialed) {
      const secret = await sourceKeyring.get(keyringAccount(item.connectionId));
      if (secret === undefined) {
        console.warn(`  ${item.name}: no credential in the source keyring; reconnect it in dev.`);
        const copy = merged.connections.find((entry) => entry.connectionId === item.connectionId);
        if (copy) Object.assign(copy, { hasCredential: false, connected: false });
      } else secrets.set(item.connectionId, secret);
    }

    const backupDir = path.join(
      options.to,
      'seed-backups',
      new Date().toISOString().replaceAll(':', '-'),
    );
    for (const copy of copies) {
      await backUp(copy.target, options.to, backupDir);
      await mkdir(path.dirname(copy.target), { recursive: true });
      await cp(copy.source, copy.target, { recursive: true, errorOnExist: true, force: false });
    }
    if (source.connections.length > 0) {
      const file = connectionsFile(options.to);
      if (await exists(file)) {
        await mkdir(path.join(backupDir, 'providers'), { recursive: true });
        await cp(file, path.join(backupDir, 'providers', 'connections.json'));
      }
      const targetKeyring = new KeyringBackend(targetId);
      for (const [connectionId, secret] of secrets)
        await targetKeyring.set(keyringAccount(connectionId), secret);
      await atomicWrite(file, parse(ServiceConnectionsFileSchema, merged));
    }
    if (await exists(backupDir)) console.log(`Replaced files are in ${backupDir}`);
    console.log('Seeded. Start `pnpm dev` again to use it.');
  } finally {
    await releaseLock(to);
  }
}

seed(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
