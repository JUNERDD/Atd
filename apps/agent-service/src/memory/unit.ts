import { createHash } from 'node:crypto';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import {
  errorMessage,
  Identifier,
  MemoryActivationSchema,
  MemoryCategorySchema,
  MemoryDescriptionSchema,
  MemoryNameSchema,
  MemoryOriginSchema,
  MemorySourceSchema,
  MemoryTargetSchema,
  MemoryUnitSchema,
  parse,
  type MemoryTarget,
  type MemoryUnit,
} from '@atd/agent-contracts';
import { Type } from 'typebox';
import { scanContent } from './scanner.js';

/**
 * One memory unit on disk (docs/plans/2026-10-04-skill-shaped-memory.md): `units/<id>/MEMORY.md`,
 * frontmatter written as JSON scalars (valid YAML, read with Pi's `parseFrontmatter`) and a
 * Markdown body. The file is the truth; its sha256 is the unit's `revision`.
 */
export const MEMORY_FILE = 'MEMORY.md';

/** A unit before it is written: everything but the revision, which comes from the file text. */
export type UnitDraft = Omit<MemoryUnit, 'revision'>;

/**
 * Characters of always-on (`core`) memory a run carries: the cap of the `memory_core` section and
 * the budget an accepted promotion to `core` must fit (run-memory.ts `coreFits`).
 */
export const CORE_BUDGET = 3000;
/** A core unit's body enters runs up to this length; a longer one enters as its description. */
export const CORE_BODY_LIMIT = 600;

/** Settings and run order: user profile first, then preferences and facts, then corrections. */
const TYPE_ORDER: Record<MemoryTarget, number> = { user: 0, memory: 1, failure: 2 };

/**
 * The frontmatter a unit file must carry. Unknown keys are refused, so a mistyped field reads as a
 * problem instead of silently falling back; `category` and `origin` are omitted when null.
 */
const UnitFrontmatterSchema = Type.Object(
  {
    id: Identifier,
    name: MemoryNameSchema,
    description: MemoryDescriptionSchema,
    type: MemoryTargetSchema,
    category: Type.Optional(Type.Union([MemoryCategorySchema, Type.Null()])),
    activation: MemoryActivationSchema,
    enabled: Type.Boolean(),
    source: MemorySourceSchema,
    origin: Type.Optional(Type.Union([MemoryOriginSchema, Type.Null()])),
    reviewed: Type.Boolean(),
    created: Type.String({ minLength: 1, maxLength: 64 }),
    updated: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

/** Frontmatter keys in the order they are written. */
const FIELDS = [
  'id',
  'name',
  'description',
  'type',
  'category',
  'activation',
  'enabled',
  'source',
  'origin',
  'reviewed',
  'created',
  'updated',
] as const satisfies ReadonlyArray<keyof UnitDraft>;

/** The file text of `draft`. Its body must already be normalized (`normalizeBody`). */
export function formatUnitFile(draft: UnitDraft): string {
  const lines = ['---'];
  for (const key of FIELDS) {
    const value = draft[key];
    if (value !== null) lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push('---', '', draft.body, '');
  return lines.join('\n');
}

/** `unit` without its revision: the draft of a changed copy. */
export function draftOf(unit: MemoryUnit): UnitDraft {
  const { revision: _revision, ...draft } = unit;
  return draft;
}

/** The unit `draft` becomes once written: its revision is the digest of the file it writes. */
export function unitOf(draft: UnitDraft): MemoryUnit {
  return { ...draft, revision: revisionOf(formatUnitFile(draft)) };
}

export function revisionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Reads one unit file found in folder `folder`. Anything that does not hold a valid unit, whose id
 * differs from its folder, or whose text the content scan blocks (a file written outside the
 * service skips the scan its writes run) answers the reason instead: such a file stays out of runs.
 */
export function parseUnitFile(
  text: string,
  folder: string,
): { unit: MemoryUnit } | { problem: string } {
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter(text);
  } catch (error) {
    return { problem: `The frontmatter could not be parsed: ${errorMessage(error)}` };
  }
  try {
    const front = parse(UnitFrontmatterSchema, parsed.frontmatter);
    if (front.id !== folder) return { problem: 'The id in MEMORY.md does not match its folder.' };
    const unit: MemoryUnit = {
      id: front.id,
      name: front.name,
      description: front.description,
      type: front.type,
      category: front.category ?? null,
      activation: front.activation,
      enabled: front.enabled,
      source: front.source,
      origin: front.origin ?? null,
      reviewed: front.reviewed,
      created: front.created,
      updated: front.updated,
      body: parsed.body,
      revision: revisionOf(text),
    };
    const blocked = scanContent(`${unit.description}\n${unit.body}`);
    if (blocked) return { problem: `MEMORY.md is not used. ${blocked}` };
    return { unit: parse(MemoryUnitSchema, unit) };
  } catch (error) {
    return { problem: `MEMORY.md is not a valid memory: ${errorMessage(error)}` };
  }
}

/** Settings and run order: by type (user, memory, failure), then by name. */
export function compareUnits(a: UnitDraft, b: UnitDraft): number {
  return (
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}
