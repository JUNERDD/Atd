import type { PluginDiagnostic } from '../model/diagnostics.js';
import type { NormalizedPlugin } from '../model/manifest.js';
import { isPluginName } from '../model/names.js';
import type { ReadonlyFs } from '../ports.js';
import { loadAgentPluginsMcp } from './agent-plugins-mcp.js';
import {
  createContext,
  isRecord,
  listDir,
  parseJson,
  readText,
  report,
  statPath,
  type AdapterContext,
} from './context.js';
import { InvalidPluginError, invalidManifest } from './errors.js';
import { readMetadata } from './metadata.js';
import { scanSkillDir } from './skill.js';

/** Agent Plugins 1.0: https://agent-plugins.org/specification */
export const AGENT_PLUGINS_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const SCHEMA_PATTERN =
  /^https:\/\/agent-plugins\.org\/schemas\/(1\.\d+\.\d+)\/plugin\.schema\.json$/;
const MANIFEST = 'plugin.json';
const METADATA_FIELDS = [
  'version',
  'description',
  'homepage',
  'repository',
  'license',
  'author',
  'keywords',
];
const KNOWN_FIELDS = new Set(['$schema', 'name', 'extensions', ...METADATA_FIELDS]);
/** Top-level extension directories are named by reverse-domain namespace (`com.example`). */
const REVERSE_DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function manifestError(messages: string[]): InvalidPluginError {
  const diagnostics: PluginDiagnostic[] = messages.map((message) => ({
    level: 'error',
    code: 'invalid-manifest',
    message,
    path: MANIFEST,
  }));
  return new InvalidPluginError(`Invalid ${MANIFEST}: ${messages.join(' ')}`, diagnostics);
}

/** Validates the closed plugin.json schema; returns the schema version to load with. */
function readSchemaVersion(ctx: AdapterContext, manifest: Record<string, unknown>): string {
  const schema = manifest.$schema;
  if (schema === AGENT_PLUGINS_SCHEMA) return '1.0.0';
  const match = typeof schema === 'string' ? SCHEMA_PATTERN.exec(schema) : null;
  if (!match?.[1]) {
    throw manifestError([`"$schema" must be "${AGENT_PLUGINS_SCHEMA}".`]);
  }
  report(
    ctx,
    'warning',
    'unknown-field',
    `plugin.json uses schema ${match[1]}; it is loaded with the 1.0.0 rules.`,
    { path: MANIFEST },
  );
  return match[1];
}

export async function normalizeAgentPlugin(fs: ReadonlyFs): Promise<NormalizedPlugin> {
  const ctx = createContext(fs);
  const text = await readText(ctx, MANIFEST);
  if (text === null) throw invalidManifest(`${MANIFEST} cannot be read.`, MANIFEST);
  const manifest = parseJson(ctx, MANIFEST, text);
  if (manifest === undefined) throw manifestError([`${MANIFEST} is not valid JSON.`]);
  if (!isRecord(manifest)) throw manifestError([`${MANIFEST} must be a JSON object.`]);
  const schemaVersion = readSchemaVersion(ctx, manifest);
  const name = manifest.name;
  if (typeof name !== 'string' || !isPluginName(name)) {
    throw manifestError([
      '"name" must be 1-64 characters of a-z, 0-9, "." and "-", starting and ending with a letter or digit, without "--" or "..".',
    ]);
  }
  for (const key of Object.keys(manifest)) {
    if (KNOWN_FIELDS.has(key)) continue;
    report(ctx, 'warning', 'unknown-field', `plugin.json field "${key}" is not defined; ignored.`, {
      path: MANIFEST,
    });
  }
  const known = Object.fromEntries(
    METADATA_FIELDS.filter((field) => field in manifest).map((field) => [field, manifest[field]]),
  );
  const { metadata, problems } = readMetadata(known, {
    repositoryObject: false,
    authorString: false,
  });
  if (problems.length > 0) throw manifestError(problems);
  readExtensions(ctx, manifest.extensions);

  await scanSkillDir(ctx, 'skills', {
    allowSelf: false,
    checkShell: false,
    visited: new Set(),
    rootName: name,
  });
  for (const entry of await listDir(ctx, '')) {
    if (entry.kind !== 'dir' || !REVERSE_DOMAIN.test(entry.name)) continue;
    report(
      ctx,
      'info',
      'unsupported-component',
      `Extension directory "${entry.name}" is not supported; ignored.`,
      { path: entry.name },
    );
  }
  if ((await statPath(ctx, 'mcp.json')) === 'file') await loadAgentPluginsMcp(ctx, schemaVersion);

  return {
    format: 'agent-plugins',
    manifest: { name, ...metadata },
    components: ctx.components,
    userConfig: [],
    diagnostics: ctx.diagnostics,
  };
}

/** `extensions` is keyed by reverse-domain namespace; the kit supports none of them. */
function readExtensions(ctx: AdapterContext, extensions: unknown): void {
  if (extensions === undefined) return;
  if (!isRecord(extensions)) throw manifestError(['"extensions" must be an object.']);
  for (const namespace of Object.keys(extensions)) {
    report(
      ctx,
      'info',
      'unsupported-component',
      `Extension namespace "${namespace}" is not supported; ignored.`,
      { path: MANIFEST },
    );
  }
}
