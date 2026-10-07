import type { MemoryUnit } from '@atd/agent-contracts';
import { escapeTags } from '../learner/prompts.js';
import { clip } from '../learner/transcript.js';

/** The memories a consolidation reads, newest change first. */
export const VIEW_CHARS = 40_000;
/** A longer body is shown clipped, and a clipped body cannot be replaced. */
export const VIEW_BODY_CHARS = 2000;
/** Room kept in the budget for the note on what it left out. */
const NOTE_CHARS = 64;

/** The memories as the consolidation sees them, and what its operations may touch. */
export interface ConsolidationView {
  text: string;
  /** Units whose whole body the view holds: only those bodies may be replaced. */
  shown: ReadonlySet<string>;
  /** Listed units that are not always on: the only ones an operation may name. */
  targets: ReadonlySet<string>;
}

/**
 * Every enabled unit within `VIEW_CHARS`, the most recently changed first, each with what the
 * rules weigh: who wrote it (`source`), whether the person has seen it (`reviewed`) and when it
 * last changed (`updated`, so a newer entry can win). Always-on (`core`) units are listed as
 * context but are never targets: like a learner, a consolidation cannot change activation, and
 * an always-on memory is one the person chose. Units past the budget are left out and untouched.
 */
export function consolidationView(units: readonly MemoryUnit[]): ConsolidationView {
  const ordered = units
    .filter((unit) => unit.enabled)
    .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  const blocks: string[] = [];
  const shown = new Set<string>();
  const targets = new Set<string>();
  let size = 0;
  for (const unit of ordered) {
    const whole = unit.body.length <= VIEW_BODY_CHARS;
    const block = unitBlock(unit, whole);
    if (size + block.length + 1 > VIEW_CHARS - NOTE_CHARS) break;
    blocks.push(block);
    size += block.length + 1;
    if (whole) shown.add(unit.name);
    if (unit.activation !== 'core') targets.add(unit.name);
  }
  const left = ordered.length - blocks.length;
  if (left) blocks.push(`[${left} older memories left out]`);
  return { text: blocks.join('\n'), shown, targets };
}

function unitBlock(unit: MemoryUnit, whole: boolean): string {
  const attributes = [
    `name="${unit.name}"`,
    `type="${unit.type}"`,
    ...(unit.category ? [`category="${unit.category}"`] : []),
    `activation="${unit.activation}"`,
    `source="${unit.source}"`,
    `reviewed="${unit.reviewed}"`,
    `updated="${attribute(unit.updated)}"`,
  ];
  const body = whole ? unit.body : clip(unit.body, VIEW_BODY_CHARS);
  return [
    `<memory ${attributes.join(' ')}>`,
    `<description>${escapeTags(unit.description)}</description>`,
    whole ? '<body>' : '<body clipped="true">',
    escapeTags(body),
    '</body>',
    '</memory>',
  ].join('\n');
}

/** A frontmatter time is any short string; quotes and brackets cannot leave its attribute. */
function attribute(value: string): string {
  return value.replace(/["<>&]/g, '');
}
