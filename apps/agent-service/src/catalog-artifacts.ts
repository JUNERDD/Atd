import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { ProductArtifactSchema, type ProductArtifact } from '@atd/agent-contracts';
import { atdAgentsDir, atdSkillsDir, realAncestorPath } from './service-fs.js';

/**
 * Personal skills and subagents have no tool of their own: the agent writes their markdown with
 * the parent's write and edit tools (tool-proxies.ts `controlled`), which alone know the resolved
 * path and whether the file was there before. A call that saved one records it in the task
 * session as this entry, joined to its block by call id (transcript-blocks.ts), so the turn's
 * artifact card survives a reload; the tool's own result details stay pi's.
 */
export const ARTIFACT_ENTRY = 'app-artifact';

export const ArtifactEntrySchema = Type.Object(
  { toolCallId: Type.String({ maxLength: 512 }), artifact: ProductArtifactSchema },
  { additionalProperties: false },
);
export type ArtifactEntry = Static<typeof ArtifactEntrySchema>;

/** Compiled once: every live reprojection checks each record on the branch. */
const ArtifactEntryValidator = Compile(ArtifactEntrySchema);

/** A session record's `app-artifact` entry; null for another record type or a malformed entry. */
export function artifactEntryOf(customType: string, data: unknown): ArtifactEntry | null {
  return customType === ARTIFACT_ENTRY && ArtifactEntryValidator.Check(data) ? data : null;
}

/** Item names in the catalogs are at most this long (atd-agents/catalog.ts `MAX_NAME`). */
const MAX_NAME = 128;

/** A catalog file one write or edit is about to change. */
interface CatalogFile {
  kind: 'skill' | 'subagent';
  /** The name the catalog falls back to without a frontmatter name: the folder or file name. */
  fallback: string;
  existed: boolean;
}

/** The path below `root` as segments; null when `real` is not below it. */
async function segmentsBelow(root: string, real: string): Promise<string[] | null> {
  const relative = path.relative(await realAncestorPath(root), real);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep);
}

/**
 * Which Personal item a write at the resolved path `real` saves: `<skills>/<name>/SKILL.md` (as
 * pi's skill loader reads a skill folder) or `<agents>/<name>.md` (as the agent catalog lists its
 * files). Other files in a skill folder, such as its references, save no item of their own.
 */
async function catalogFileAt(real: string): Promise<CatalogFile | null> {
  const skill = await segmentsBelow(atdSkillsDir(), real);
  const agent = skill ? null : await segmentsBelow(atdAgentsDir(), real);
  const [folder, file] = skill ?? [];
  const found: Omit<CatalogFile, 'existed'> | null =
    skill?.length === 2 && folder && file === 'SKILL.md'
      ? { kind: 'skill', fallback: folder }
      : agent?.length === 1 && agent[0]?.endsWith('.md')
        ? { kind: 'subagent', fallback: agent[0].slice(0, -'.md'.length) }
        : null;
  if (!found?.fallback) return null;
  const existed = await stat(real).then(
    () => true,
    () => false,
  );
  return { ...found, existed };
}

/** The name the catalog loads a written file under: its frontmatter name, else the fallback. */
async function loadedName(real: string, fallback: string): Promise<string> {
  try {
    const { frontmatter } = parseFrontmatter<{ name?: unknown }>(await readFile(real, 'utf8'));
    const declared = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
    return (declared || fallback).slice(0, MAX_NAME);
  } catch {
    // Unreadable or not YAML: the catalog lists it by its file name with a problem.
    return fallback.slice(0, MAX_NAME);
  }
}

/** Where the entry goes: the task session's manager. */
type EntrySink = { appendCustomEntry(customType: string, data?: unknown): string };

/** Records the item a successful write saved, under the call's id. */
export interface CatalogArtifactWrite {
  record(sessions: EntrySink, toolCallId: string): Promise<void>;
}

/**
 * Looks at a write or edit before it runs; null unless it targets a catalog file. Call `record`
 * only once the tool succeeded: a failed or declined write saved nothing.
 */
export async function catalogArtifactWrite(real: string): Promise<CatalogArtifactWrite | null> {
  const file = await catalogFileAt(real);
  if (!file) return null;
  return {
    record: async (sessions, toolCallId) => {
      const name = await loadedName(real, file.fallback);
      const artifact: ProductArtifact = {
        kind: file.kind,
        action: file.existed ? 'updated' : 'created',
        id: name,
        name,
      };
      sessions.appendCustomEntry(ARTIFACT_ENTRY, { toolCallId, artifact } satisfies ArtifactEntry);
    },
  };
}
