import { Type, type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';
import {
  MemoryBodySchema,
  MemoryCategorySchema,
  MemoryDescriptionSchema,
  MemoryNameSchema,
  MemoryTargetSchema,
} from '@atd/agent-contracts';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { LearnerOp } from '../engine-types.js';

/**
 * Turns a memory review's reply into `LearnerOp`s. The extraction (balanced JSON spans, fenced and
 * inline JSON, the reasoning-channel fallback) is adapted from pi-hermes-memory 0.9.9 (MIT,
 * © 2025 Chandra Teja), src/handlers/review-memory-ops.ts; each operation is then validated
 * against the unit contract, and an invalid one is dropped with its reason.
 */

/** A reply's text: the answer, or the reasoning when the answer channel is empty. */
export interface LearnerReply {
  text: string;
  source: 'text' | 'thinking';
}

/** The operations to commit and the reasons for those dropped. */
export interface ParsedOps {
  ops: LearnerOp[];
  dropped: string[];
}

/** One review adds a few memories at most; anything beyond is a runaway reply. */
export const MAX_OPS = 6;

/** A proposal's reason, as `MemoryProposal.reason` holds it. */
const Reason = Type.String({ minLength: 1, maxLength: 1000 });

const OPS = {
  create: Type.Object({
    op: Type.Literal('create'),
    name: Type.Optional(MemoryNameSchema),
    description: MemoryDescriptionSchema,
    type: MemoryTargetSchema,
    category: Type.Optional(MemoryCategorySchema),
    body: MemoryBodySchema,
  }),
  update: Type.Object({
    op: Type.Literal('update'),
    name: MemoryNameSchema,
    description: Type.Optional(MemoryDescriptionSchema),
    body: Type.Optional(MemoryBodySchema),
  }),
  remove: Type.Object({ op: Type.Literal('remove'), name: MemoryNameSchema, reason: Reason }),
  propose_core: Type.Object({
    op: Type.Literal('propose_core'),
    name: MemoryNameSchema,
    reason: Reason,
  }),
  propose_skill: Type.Object({
    op: Type.Literal('propose_skill'),
    name: MemoryNameSchema,
    description: MemoryDescriptionSchema,
    body: MemoryBodySchema,
    reason: Reason,
  }),
} satisfies Record<LearnerOp['op'], TSchema>;

/** A compiled operation schema; the static type of each is one `LearnerOp` variant. */
interface OpValidator {
  Check(value: unknown): value is LearnerOp;
  Errors(value: unknown): readonly { instancePath: string; message: string }[];
}

// Compiled without a contextual type: one would replace the validator type `Compile` infers.
const VALIDATORS = {
  create: Compile(OPS.create),
  update: Compile(OPS.update),
  remove: Compile(OPS.remove),
  propose_core: Compile(OPS.propose_core),
  propose_skill: Compile(OPS.propose_skill),
};

/**
 * The reply's answer text, or its reasoning when the answer is empty: servers that force thinking
 * on can park the whole answer there. Redacted reasoning carries nothing to recover.
 */
export function replyChannel(content: AssistantMessage['content']): LearnerReply {
  const text = content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
  if (text.trim()) return { text, source: 'text' };
  const thinking = content
    .flatMap((part) => (part.type === 'thinking' && part.redacted !== true ? [part.thinking] : []))
    .join('\n');
  return { text: thinking, source: 'thinking' };
}

/**
 * The reply's operations, or null when it holds no operations payload. A reasoning-channel
 * payload with text after it is a draft the model may have revised, so only its creates count:
 * a missed save is recoverable, applying an update the model rejected is not.
 */
export function parseLearnerReply(reply: LearnerReply): ParsedOps | null {
  if (reply.source === 'text') {
    const payload = extractPayload(reply.text);
    return payload ? validOps(payload.operations) : null;
  }
  const candidate = lastOperationsObject(reply.text);
  if (!candidate) return null;
  const parsed = validOps(candidate.payload.operations);
  if (candidate.trailing) return parsed;
  const drafts = parsed.ops.filter((op) => op.op !== 'create');
  return {
    ops: parsed.ops.filter((op) => op.op === 'create'),
    dropped: [
      ...parsed.dropped,
      ...drafts.map((op) => `${op.op} ${op.name}: drafted in reasoning`),
    ],
  };
}

/** Validates each operation; unknown fields are ignored, invalid operations dropped. */
function validOps(operations: unknown[]): ParsedOps {
  const ops: LearnerOp[] = [];
  const dropped: string[] = [];
  operations.forEach((item, index) => {
    const label = `operation ${index + 1}`;
    if (index >= MAX_OPS) {
      dropped.push(`${label}: over the limit of ${MAX_OPS} per review`);
      return;
    }
    const op = toOp(item);
    if (typeof op === 'string') dropped.push(`${label}: ${op}`);
    else ops.push(op);
  });
  return { ops, dropped };
}

/** The operation, or why it is invalid. */
function toOp(item: unknown): LearnerOp | string {
  if (!isRecord(item)) return 'not an object';
  const kind = item.op;
  if (!isOpKind(kind)) return `unknown op ${JSON.stringify(kind) ?? 'undefined'}`.slice(0, 80);
  const value = normalized(item, Object.keys(OPS[kind].properties));
  // Categories belong to failure units; Settings shows and edits them for no other type.
  if (kind === 'create' && value.type !== 'failure') delete value.category;
  if (kind === 'update' && value.description === undefined && value.body === undefined)
    return 'update changes nothing';
  const validator: OpValidator = VALIDATORS[kind];
  if (validator.Check(value)) return value;
  const issue = validator.Errors(value)[0];
  return issue ? `${kind}${issue.instancePath} ${issue.message}` : `invalid ${kind}`;
}

/** The known fields, trimmed; names lowercased, descriptions kept on one line, nulls dropped. */
function normalized(
  item: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const key of keys) {
    const field = item[key];
    if (field === undefined || field === null) continue;
    if (typeof field !== 'string') value[key] = field;
    else if (key === 'name') value[key] = field.trim().toLowerCase();
    else if (key === 'description') value[key] = field.replace(/\s+/g, ' ').trim();
    else value[key] = field.trim();
  }
  return value;
}

function isOpKind(value: unknown): value is LearnerOp['op'] {
  return typeof value === 'string' && Object.hasOwn(OPS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON object with an `operations` array; any other object never claims the parse. */
interface OperationsPayload {
  operations: unknown[];
}

function asPayload(value: unknown): OperationsPayload | null {
  return isRecord(value) && Array.isArray(value.operations)
    ? { operations: value.operations }
    : null;
}

function parsePayload(text: string): OperationsPayload | null {
  try {
    return asPayload(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Answer-channel extraction: the whole reply, a fenced block, the first-to-last brace slice, then
 * the last balanced object that parses as a payload. A candidate without an `operations` array
 * falls through to the next step, so a stray snippet cannot hide a valid answer after it.
 */
function extractPayload(reply: string): OperationsPayload | null {
  const text = reply.trim();
  if (!text) return null;
  const whole = parsePayload(text);
  if (whole) return whole;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const fencedPayload = fenced ? parsePayload(fenced.trim()) : null;
  if (fencedPayload) return fencedPayload;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const sliced = start >= 0 && end > start ? parsePayload(text.slice(start, end + 1)) : null;
  return sliced ?? lastOperationsObject(text)?.payload ?? null;
}

/**
 * The last balanced object that parses as a payload, scanning from the end: reasoning often
 * restates the schema or drafts an answer before the final one. `trailing` says whether only
 * whitespace follows it.
 */
function lastOperationsObject(
  text: string,
): { payload: OperationsPayload; trailing: boolean } | null {
  const spans = balancedObjectSpans(text);
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    if (!span) continue;
    const payload = parsePayload(text.slice(span[0], span[1] + 1));
    if (payload) return { payload, trailing: text.slice(span[1] + 1).trim() === '' };
  }
  return null;
}

/**
 * Balanced `{…}` regions at any depth, string- and escape-aware. Every matched pair is kept, not
 * just top-level ones, so an unbalanced `{` in prose cannot hide a later object.
 */
function balancedObjectSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const open: number[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) escaped = false;
    else if (inString) {
      if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') open.push(index);
    else if (char === '}') {
      const start = open.pop();
      if (start !== undefined) spans.push([start, index]);
    }
  }
  return spans;
}
